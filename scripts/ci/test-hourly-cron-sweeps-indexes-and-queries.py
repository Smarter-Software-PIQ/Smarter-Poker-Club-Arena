#!/usr/bin/env python3
"""Isolated native PostgreSQL 17 qualification for hourly pg_cron sweep optimizations.

Proves on a fresh throwaway PG17 cluster (Unix socket, zero network, zero production writes):
  1. All 13 live preimage functions load with exact production pg_get_functiondef MD5s.
  2. Migration refuses non-installer role, missing/invalid index, and drifted preimage.
  3. CONCURRENTLY preamble + single BEGIN/COMMIT transaction (including all 13 @probe-for
     runtime probes) installs cleanly and passes its exact @live-proof assertion.
  4. Re-applying the migration is idempotent and preserves proowner, prosecdef, proconfig, proacl.
  5. Every single one of the 13 optimized functions returns 100% identical outputs to its
     production preimage across edge cases (NULL/non-NULL cutoffs, late-backfilled attributions,
     house corrections, BBJ self-moves/cross-pool/non-canonical labels/baseline resets/write
     failures, safe-horizon checkpoint advances, NULL created_at contributions, co-seating,
     undeclared money paths, missing champions, stalled knockout candidates).
  6. EXPLAIN proves every new index is valid and usable by its target query.
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / 'scripts' / 'ci' / 'fixtures' / 'hourly-cron-perf'

PREIMAGES = {
    'public.fn_club_rake_rollup_day(uuid,date)': ('fn_club_rake_rollup_day.sql', 'a71de30b73dbe5ccfe3cc32c9e363c50'),
    'public.fn_ca_reporting_rollups_from_facts(date)': ('fn_ca_reporting_rollups_from_facts.sql', 'cc3dde7765d2ed383b26ea9c96cd9a20'),
    'public.fn_pay_backed_payout_shortfalls(boolean,integer)': ('fn_pay_backed_payout_shortfalls.sql', '8a6a20c6856b200dfa0ff7a1550044e4'),
    'public.fn_bbj_reconcile(uuid)': ('fn_bbj_reconcile.sql', '516d3dbfab2ab31588907ef4934771e3'),
    'public.fn_bbj_reconcile_all()': ('fn_bbj_reconcile_all.sql', 'e1250fbc290628ac23400c111624eef4'),
    'public.fn_rake_bbj_invariants(integer)': ('fn_rake_bbj_invariants.sql', '2a8c79452ced863cfb15364d1e62a40c'),
    'public.fn_union_integrity_sweep(uuid,integer)': ('fn_union_integrity_sweep.sql', 'f764df872c6812b8186bf2329e670f76'),
    'public.fn_ca_completed_without_a_champion()': ('fn_ca_completed_without_a_champion.sql', '962fc139f74e4840902d5a4655ac8f26'),
    'public.fn_ca_undeclared_money_paths()': ('fn_ca_undeclared_money_paths.sql', '86cf4170398c88a22f012c0748998fe7'),
    'public.fn_ca_ledger_audit_checkpoint_advance()': ('fn_ca_ledger_audit_checkpoint_advance.sql', 'dbb5a1efc418461bfd190e5fdeb204e4'),
    'public.fn_bbj_conservation_check()': ('fn_bbj_conservation_check.sql', '45166a61fd8b0f36a4bed1127b075e83'),
    'public.fn_bbj_promo_bank_check()': ('fn_bbj_promo_bank_check.sql', '8061f898a2b966eda4c518851fd7e8b9'),
    'public.fn_ca_knockout_door_stalled(integer)': ('fn_ca_knockout_door_stalled.sql', '0ac830e35079db87132632bab2e6cf37'),
}

NEW_INDEXES = [
    'idx_chip_ledger_house_corrections_by_tournament',
    'idx_table_seats_joined_at_cover',
    'idx_tournaments_completed_id',
    'idx_tournament_players_winner_tid',
    'idx_bbj_contributions_created_at_cover',
    'idx_tournaments_private_union',
    'idx_tables_private_union',
    'idx_tables_live_union_club_mismatch',
    'idx_tournament_knockout_candidates_pending_unresolved',
    'idx_tournament_knockout_candidates_resolved_at',
    'idx_ca_ledger_write_failures_occurred_at',
]


def find_pg_bin():
    for cand in [
        os.environ.get('PG_BIN'),
        '/opt/homebrew/opt/postgresql@17/bin',
        '/usr/local/opt/postgresql@17/bin',
        '/usr/lib/postgresql/17/bin',
    ]:
        if cand and (pathlib.Path(cand) / 'initdb').exists():
            return pathlib.Path(cand)
    p = shutil.which('initdb')
    if p:
        return pathlib.Path(p).parent
    raise RuntimeError('PostgreSQL 17 binaries not found (set PG_BIN)')


def find_migration(explicit):
    if explicit:
        return pathlib.Path(explicit).resolve()
    cands = sorted((ROOT / 'supabase' / 'migrations').glob('*_hourly_cron_sweeps_indexes_checkpoints_and_query_plans.sql'))
    if not cands:
        raise RuntimeError('Migration file not found in supabase/migrations/')
    return cands[-1]


def split_migration(sql_text):
    m = re.search(r'^BEGIN\s*;[ \t]*$', sql_text, re.M)
    assert m, 'Migration must contain a BEGIN; line'
    preamble = sql_text[:m.start()]
    body = sql_text[m.start():]
    # Strip -- comments from preamble and split statements
    no_comments = re.sub(r'--[^\n]*', '', preamble)
    stmts = [s.strip() + ';' for s in no_comments.split(';') if s.strip()]
    for s in stmts:
        assert re.match(r'^CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+', s, re.I), (
            f'Unexpected preamble statement: {s[:80]}'
        )
    return stmts, body


def extract_live_proof(sql_text):
    m = re.search(r'^--\s*@live-proof:\s*(.+)$', sql_text, re.M)
    assert m, 'Missing -- @live-proof: header'
    return m.group(1).strip()


SCHEMA_SQL = r"""
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unprivileged_tester') THEN CREATE ROLE unprivileged_tester LOGIN; END IF;
END $$;

CREATE TABLE public.unions (id uuid PRIMARY KEY, name text);
CREATE TABLE public.clubs (
  id uuid PRIMARY KEY, name text, asset text DEFAULT 'chips',
  is_platform boolean DEFAULT false, union_id uuid, is_union boolean DEFAULT false,
  chip_treasury numeric DEFAULT 0
);
CREATE TABLE public.union_clubs (union_id uuid, club_id uuid, PRIMARY KEY (union_id, club_id));
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean DEFAULT false);
CREATE TABLE public.agents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, club_id uuid);
CREATE TABLE public.club_members (club_id uuid, user_id uuid, agent_id uuid, chip_balance numeric DEFAULT 0, PRIMARY KEY (club_id, user_id));
CREATE TABLE public.tables (
  id uuid PRIMARY KEY, club_id uuid, union_id uuid, tournament_id uuid,
  small_blind numeric DEFAULT 1, big_blind numeric DEFAULT 2,
  game_variant text DEFAULT 'NLH', is_private boolean DEFAULT false,
  is_deleted boolean DEFAULT false, status text DEFAULT 'active'
);
CREATE TABLE public.table_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, club_id uuid,
  joined_at timestamptz DEFAULT now(), left_at timestamptz
);
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY, name text, club_id uuid, union_id uuid, status text,
  variant text, tournament_type text, satellite_target_id uuid,
  prize_pool numeric DEFAULT 0, created_at timestamptz DEFAULT now(), ended_at timestamptz,
  is_private boolean DEFAULT false
);
CREATE TABLE public.tournament_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  status text, position integer
);
CREATE TABLE public.tournament_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  position integer, source text, amount numeric, metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.tournament_satellite_awards (
  tournament_id uuid, place integer, delivery_kind text, ticket_id uuid,
  PRIMARY KEY (tournament_id, place)
);
CREATE TABLE public.tournament_tickets (id uuid PRIMARY KEY, status text);
CREATE TABLE public.tournament_guarantee_overlays (tournament_id uuid PRIMARY KEY, amount numeric);
CREATE TABLE public.tournament_conservation_baseline (tournament_id uuid PRIMARY KEY, amount numeric);
CREATE TABLE public.tournament_payout_backfill_log (
  tournament_id uuid PRIMARY KEY, top_up numeric, delta_before numeric, delta_after numeric
);
CREATE TABLE public.tournament_knockout_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
  created_at timestamptz DEFAULT now(), rebuy_prompt_until timestamptz, resolved_at timestamptz
);
CREATE TABLE public.hand_history (
  id uuid PRIMARY KEY, table_id uuid, tournament_id uuid, hand_number bigint,
  rake_amount numeric DEFAULT 0, bbj_amount numeric DEFAULT 0,
  game_variant text, players jsonb, community_cards text[], community_cards2 text[],
  showdown jsonb, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.hand_atomic_commits (
  hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint,
  post_commit_payload jsonb, post_commit_completed_at timestamptz, committed_at timestamptz
);
CREATE TABLE public.cash_rake_pending (hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint, created_at timestamptz);
CREATE TABLE public.hand_bank_obligation_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_id uuid, table_id uuid, hand_number bigint,
  kind text, created_at timestamptz
);
CREATE TABLE public.ca_diamond_rake_accrual (table_id uuid, hand_number bigint, kind text, amount numeric);
CREATE TABLE public.ca_rake_rules (id integer PRIMARY KEY, bbj_min_players_dealt integer, bbj_ineligible_variants text[]);
INSERT INTO public.ca_rake_rules VALUES (1, 3, ARRAY['short_deck']);

CREATE TABLE public.rake_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_id uuid, table_id uuid, club_id uuid,
  tournament_id uuid, is_tournament boolean DEFAULT false, source text,
  rake_amount numeric DEFAULT 0, bbj_contribution numeric DEFAULT 0, pot_size numeric DEFAULT 0,
  num_players integer, rake_method text, player_contributions jsonb,
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.rake_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rake_record_id uuid, hand_id uuid,
  club_id uuid, player_id uuid, rake_amount numeric DEFAULT 0,
  weighted_rake_credit numeric DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_rake_attributions_club_created ON public.rake_attributions (club_id, created_at) INCLUDE (player_id, rake_amount);
CREATE INDEX idx_rake_records_club_data_tournament_window ON public.rake_records (created_at, tournament_id) INCLUDE (rake_amount, metadata) WHERE is_tournament AND rake_amount <> 0 AND tournament_id IS NOT NULL;

CREATE TABLE public.club_rake_daily_user (club_id uuid, day date, user_id uuid, rake_amount numeric, hands bigint);
CREATE TABLE public.club_rake_rollup_complete (club_id uuid, day date, rows_written integer, computed_at timestamptz, PRIMARY KEY (club_id, day));
CREATE TABLE public.ca_club_data_fact (
  club_id uuid, stat_date date, game_id uuid, kind text, user_id uuid,
  fee numeric DEFAULT 0, buyins numeric DEFAULT 0, cashouts numeric DEFAULT 0, winnings numeric DEFAULT 0,
  PRIMARY KEY (club_id, stat_date, game_id, user_id)
);
CREATE TABLE public.club_table_daily (
  club_id uuid, table_id uuid, stat_date date, union_id uuid, rake numeric, hands int,
  players int, buyins numeric, cashouts numeric, net numeric, source_rows int, updated_at timestamptz
);
CREATE TABLE public.ca_club_table_player_daily (club_id uuid, table_id uuid, stat_date date, user_id uuid, PRIMARY KEY (club_id, table_id, stat_date, user_id));
CREATE TABLE public.ca_club_player_daily (club_id uuid, user_id uuid, stat_date date, cash_net numeric, tournament_net numeric, updated_at timestamptz);
CREATE TABLE public.ca_club_tournament_daily (club_id uuid, tournament_id uuid, stat_date date, fee numeric, winnings numeric, updated_at timestamptz);
CREATE TABLE public.ca_club_tournament_player_daily (club_id uuid, tournament_id uuid, user_id uuid, stat_date date, updated_at timestamptz, PRIMARY KEY (club_id, tournament_id, user_id, stat_date));
CREATE TABLE public.cash_participant_funding_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), funding_club_id uuid, operation_kind text,
  table_id uuid, account_entity_id uuid, seat_joined_at timestamptz, recorded_at timestamptz
);
CREATE TABLE public.cash_seat_move_receipts (
  move_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, to_table_id uuid,
  player_id uuid, created_at timestamptz
);

CREATE TABLE public.chip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, tournament_id uuid,
  from_type text, from_entity_id uuid, from_label text,
  to_type text, to_entity_id uuid, to_label text,
  category text, amount numeric NOT NULL, idempotency_key text,
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, table_id uuid, related_entity_id uuid,
  type text, category text, amount numeric, description text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.chip_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, from_user_id uuid, to_user_id uuid,
  transaction_type text, amount numeric, metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_chip_tx_club_created ON public.chip_transactions (club_id, created_at DESC);

CREATE TABLE public.financial_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb DEFAULT '{}'::jsonb, resolved boolean DEFAULT false, resolved_at timestamptz,
  resolution text, created_at timestamptz DEFAULT now()
);

CREATE TABLE public.bbj_pools (
  id uuid PRIMARY KEY, union_id uuid, club_id uuid, status text DEFAULT 'active',
  main_balance numeric DEFAULT 0, backup_balance numeric DEFAULT 0, promo_balance numeric DEFAULT 0,
  pool_amount numeric DEFAULT 0, total_paid_out numeric DEFAULT 0, merged_into_pool_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.bbj_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_id uuid, hand_id uuid,
  amount numeric NOT NULL, main_portion numeric, backup_portion numeric, promo_portion numeric,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.bbj_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), total_amount numeric);
CREATE TABLE public.bbj_conservation_baseline (
  id integer PRIMARY KEY, baseline_gap numeric DEFAULT 0, tolerance numeric DEFAULT 1.00,
  pre_ledger_payouts numeric DEFAULT 0, opening_seeds numeric DEFAULT 0,
  lifetime_residue numeric DEFAULT 0, epoch_residue numeric DEFAULT 0
);
INSERT INTO public.bbj_conservation_baseline (id) VALUES (1);

CREATE TABLE public.ca_bbj_pool_snapshots (
  id bigserial PRIMARY KEY, pool_id uuid NOT NULL, taken_at timestamptz NOT NULL DEFAULT now(),
  is_baseline boolean NOT NULL DEFAULT false, prev_id bigint,
  main numeric NOT NULL, backup numeric NOT NULL, promo numeric NOT NULL,
  journal_main numeric NOT NULL DEFAULT 0, journal_backup numeric NOT NULL DEFAULT 0, journal_promo numeric NOT NULL DEFAULT 0,
  drops_since numeric NOT NULL DEFAULT 0, payouts_since numeric NOT NULL DEFAULT 0,
  sweeps_since numeric NOT NULL DEFAULT 0, funding_since numeric NOT NULL DEFAULT 0,
  moves_since numeric NOT NULL DEFAULT 0, write_failures integer NOT NULL DEFAULT 0,
  unexplained_main numeric NOT NULL DEFAULT 0, unexplained_backup numeric NOT NULL DEFAULT 0,
  unexplained_promo numeric NOT NULL DEFAULT 0, note text, basis_version text,
  UNIQUE (pool_id, taken_at)
);
CREATE TABLE public.ca_bbj_bucket_moves (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_bank text, to_bank text, amount numeric);
CREATE TABLE public.union_wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), union_id uuid, tx_type text, amount numeric);
CREATE TABLE public.money_flow_checkpoint (metric_key text PRIMARY KEY, as_of timestamptz, total numeric);
CREATE TABLE public.ca_ledger_write_failures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL, message text);
CREATE TABLE public.ca_detector_runs (id bigserial PRIMARY KEY, detector text, detail jsonb, ran_at timestamptz DEFAULT now());
CREATE TABLE public.ca_chip_baseline (id bigserial PRIMARY KEY, taken_at timestamptz NOT NULL);
CREATE TABLE public.ca_ledger_audit_marks (
  metric text PRIMARY KEY, from_at timestamptz NOT NULL, through_at timestamptz NOT NULL,
  to_total numeric NOT NULL DEFAULT 0, from_total numeric NOT NULL DEFAULT 0,
  legs bigint NOT NULL DEFAULT 0, advanced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ca_ledger_audit_member_net (club_id uuid, user_id uuid, net numeric NOT NULL DEFAULT 0, PRIMARY KEY (club_id, user_id));
CREATE TABLE public.ca_ledger_audit_bbj_pool (
  pool_id uuid PRIMARY KEY, seeded numeric NOT NULL DEFAULT 0, burned numeric NOT NULL DEFAULT 0,
  absorbed numeric, absorbed_to timestamptz
);
CREATE TABLE public.ca_money_rpc_registry (proname text PRIMARY KEY, status text);

-- Minimal deterministic helper stubs (exact contracts, no production dependencies)
CREATE TABLE public._test_cutoffs (scope_kind text, scope_id uuid, cutoff timestamptz, PRIMARY KEY (scope_kind, scope_id));
CREATE OR REPLACE FUNCTION public.fn_ca_launch_accounting_cutoff(p_kind text, p_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT cutoff FROM public._test_cutoffs WHERE scope_kind = p_kind AND scope_id = p_id;
$$;
CREATE OR REPLACE FUNCTION public.fn_ca_launch_accounting_accepts(p_club_id uuid, p_earned_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN b.cutoff IS NULL THEN true ELSE p_earned_at IS NOT NULL AND isfinite(p_earned_at) AND p_earned_at >= b.cutoff END
  FROM (SELECT public.fn_ca_launch_accounting_cutoff('club', p_club_id) cutoff) b;
$$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_data_facts_from() RETURNS date LANGUAGE sql STABLE AS $$ SELECT date '2026-01-01' $$;
CREATE OR REPLACE FUNCTION public.fn_ca_cash_reporting_club(p_u uuid, p_tc uuid, p_uid uuid) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT p_tc $$;
CREATE OR REPLACE FUNCTION public.fn_tournament_payout_reconcile(p_tid uuid, p_apply boolean)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('total_top_up', 10.00, 'total_settled', 10.00) $$;
CREATE OR REPLACE FUNCTION public.fn_tournament_conservation_delta(p_tid uuid) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 0::numeric $$;
CREATE OR REPLACE FUNCTION public.fn_effective_bbj_drop(
  p_bb numeric, p_n int, p_flop boolean, p_club uuid, p_tid uuid, p_var text, p_sb numeric, p_pot numeric, p_rake numeric
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_flop AND COALESCE(p_n, 0) >= 3 AND COALESCE(p_var, '') <> 'short_deck' THEN 1.0 ELSE 0.0 END;
$$;
CREATE OR REPLACE FUNCTION public.fn_bbj_open_pool_baseline(p_pool_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  SELECT COALESCE(main_balance,0) AS m, COALESCE(backup_balance,0) AS bk, COALESCE(promo_balance,0) AS pr
    INTO b FROM public.bbj_pools WHERE id = p_pool_id;
  INSERT INTO public.ca_bbj_pool_snapshots (pool_id, taken_at, is_baseline, main, backup, promo)
  VALUES (p_pool_id, now() - interval '10 minutes', true, b.m, b.bk, b.pr)
  ON CONFLICT DO NOTHING;
END $$;
CREATE TABLE public._test_side_effects (id bigserial PRIMARY KEY, kind text, payload jsonb);
CREATE OR REPLACE FUNCTION public.fn_ca_kill_switch_trip(p_src text, p_amt numeric, p_msg text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public._test_side_effects (kind, payload) VALUES ('kill_switch', jsonb_build_object('src', p_src, 'amt', p_amt, 'msg', p_msg));
$$;
CREATE OR REPLACE FUNCTION public.fn_ca_raise_drift_incident(
  p_source text, p_class text, p_sev text, p_key text, p_disc numeric, p_exp numeric, p_act numeric,
  p_layer text, p_tbl text, p_ent uuid, p_club uuid, p_union uuid,
  p_a text, p_b text, p_c text, p_d text, p_e text, p_f text,
  p_msg text, p_bal boolean, p_meta jsonb
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public._test_side_effects (kind, payload) VALUES ('drift_incident', jsonb_build_object('source', p_source, 'sev', p_sev, 'disc', p_disc, 'pool_id', p_meta->>'pool_id'));
$$;
CREATE OR REPLACE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.fn_is_union_overseer(p_u uuid, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.fn_union_agent_roster_sustained_edge(p_u uuid, p_a uuid, p_d int) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.fn_union_transfer_counts_as_dump(p_ct public.chip_transactions) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT p_ct.from_user_id IS NOT NULL AND p_ct.to_user_id IS NOT NULL
     AND p_ct.transaction_type NOT IN ('agent_to_player_transfer','rakeback','buyin','cashout',
       'club_bank_claim','club_bank_send','cashout_request_escrow','cashout_approved','cashout_denied')
     AND NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.user_id = p_ct.from_user_id AND a.club_id = p_ct.club_id)
     AND NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.user_id = p_ct.from_user_id AND m.club_id = p_ct.club_id AND m.agent_id = p_ct.to_user_id)
     AND (p_ct.metadata->>'assigned_agent_id') IS DISTINCT FROM p_ct.to_user_id::text;
$$;
CREATE OR REPLACE FUNCTION public.fn_bbj_contributions_total() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(amount), 0) FROM public.bbj_contributions;
$$;
CREATE OR REPLACE FUNCTION public.fn_ca_autoledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_autoledger_clubs AFTER UPDATE ON public.clubs FOR EACH ROW EXECUTE FUNCTION public.fn_ca_autoledger('chip_treasury=club_treasury');
CREATE TRIGGER trg_autoledger_members AFTER UPDATE ON public.club_members FOR EACH ROW EXECUTE FUNCTION public.fn_ca_autoledger('chip_balance=player_wallet');

-- Test functions for fn_ca_undeclared_money_paths()
CREATE OR REPLACE FUNCTION public.zz_test_undeclared_door(p_club uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.clubs SET chip_treasury = chip_treasury + 1 WHERE id = p_club; END $$;
CREATE OR REPLACE FUNCTION public.zz_test_declared_door(p_club uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_ca_declare_ledger('t','x',p_club); UPDATE public.clubs SET chip_treasury = chip_treasury + 1 WHERE id = p_club; END $$;
CREATE OR REPLACE FUNCTION public.zz_test_autoskip_door(p_club uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('app.ledger_autoskip_clubs','1',true); UPDATE public.clubs SET chip_treasury = chip_treasury + 1 WHERE id = p_club; INSERT INTO public.chip_ledger (amount) VALUES (1); END $$;
CREATE OR REPLACE FUNCTION public.zz_test_system_door(p_club uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.clubs SET chip_treasury = chip_treasury + 1 WHERE id = p_club; END $$;
INSERT INTO public.ca_money_rpc_registry VALUES ('zz_test_system_door', 'system');
CREATE OR REPLACE FUNCTION public.zz_test_nonmoney_update(p_club uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.clubs SET name = 'ok' WHERE id = p_club; END $$;
"""

ACL_SETUP_SQL = r"""
REVOKE ALL ON FUNCTION public.fn_club_rake_rollup_day(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_club_rake_rollup_day(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_reporting_rollups_from_facts(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_reporting_rollups_from_facts(date) TO service_role;
REVOKE ALL ON FUNCTION public.fn_pay_backed_payout_shortfalls(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pay_backed_payout_shortfalls(boolean, integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_bbj_reconcile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_reconcile(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_bbj_reconcile_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_reconcile_all() TO service_role;
REVOKE ALL ON FUNCTION public.fn_rake_bbj_invariants(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rake_bbj_invariants(integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_union_integrity_sweep(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_union_integrity_sweep(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_completed_without_a_champion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_completed_without_a_champion() TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_undeclared_money_paths() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_undeclared_money_paths() TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_ledger_audit_checkpoint_advance() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_bbj_conservation_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_conservation_check() TO service_role;
REVOKE ALL ON FUNCTION public.fn_bbj_promo_bank_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_promo_bank_check() TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_knockout_door_stalled(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_knockout_door_stalled(integer) TO service_role;
"""

FIXTURE_SQL = r"""
-- Unions, clubs, profiles
INSERT INTO public.unions VALUES ('fade0000-0000-0000-0000-000000000001', 'Midway');
INSERT INTO public.clubs (id, name, asset, is_platform, union_id, is_union) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ClubNullCutoff', 'chips', false, 'fade0000-0000-0000-0000-000000000001', false),
  ('22222222-2222-2222-2222-222222222222', 'ClubWithCutoff', 'chips', false, 'fade0000-0000-0000-0000-000000000001', false),
  ('33333333-3333-3333-3333-333333333333', 'DiamondPlatform', 'diamonds', true, NULL, false);
INSERT INTO public.union_clubs VALUES
  ('fade0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('fade0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- ClubWithCutoff has cutoff at yesterday 12:00 UTC
INSERT INTO public._test_cutoffs VALUES
  ('club', '22222222-2222-2222-2222-222222222222', (((now() AT TIME ZONE 'UTC')::date - 1)::timestamp AT TIME ZONE 'UTC') + interval '12 hours');

INSERT INTO public.profiles (id, is_horse) VALUES
  ('aaaa0000-0000-0000-0000-000000000001', false),
  ('aaaa0000-0000-0000-0000-000000000002', false),
  ('aaaa0000-0000-0000-0000-000000000003', true),
  ('aaaa0000-0000-0000-0000-000000000004', true),
  ('aaaa0000-0000-0000-0000-000000000005', false);
INSERT INTO public.agents (user_id, club_id) VALUES ('aaaa0000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.club_members (club_id, user_id, agent_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000005'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000002', NULL);

-- Tables (10 tables for co-seating + cash hands)
INSERT INTO public.tables (id, club_id, union_id, small_blind, big_blind, game_variant, status)
SELECT ('bbbb0000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       '11111111-1111-1111-1111-111111111111', 'fade0000-0000-0000-0000-000000000001', 1, 2, 'NLH', 'active'
  FROM generate_series(1, 10) g;

-- Co-seating: human 1 + human 2 share 9 tables (flagged); horse 3 + horse 4 share 9 tables (ignored!)
INSERT INTO public.table_seats (table_id, user_id, club_id, joined_at)
SELECT ('bbbb0000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, u, '11111111-1111-1111-1111-111111111111', now() - interval '2 hours'
  FROM generate_series(1, 9) g,
       (VALUES ('aaaa0000-0000-0000-0000-000000000001'::uuid),
               ('aaaa0000-0000-0000-0000-000000000002'::uuid),
               ('aaaa0000-0000-0000-0000-000000000003'::uuid),
               ('aaaa0000-0000-0000-0000-000000000004'::uuid)) v(u);

-- Direct chip transfers for Job 123 (1 real dump + 1 cashout to own agent + 1 agent send + 1 out-of-scope)
INSERT INTO public.chip_transactions (club_id, from_user_id, to_user_id, transaction_type, amount, created_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000002', 'peer_transfer', 250.00, now() - interval '3 hours'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000005', 'peer_transfer', 100.00, now() - interval '3 hours'),
  ('11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000005', 'aaaa0000-0000-0000-0000-000000000001', 'peer_transfer', 100.00, now() - interval '3 hours'),
  ('33333333-3333-3333-3333-333333333333', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000002', 'peer_transfer', 999.00, now() - interval '3 hours');

-- Job 128 fixtures: yesterday's cash rake + attributions (including a late-backfilled attribution + cutoff club!)
DO $$
DECLARE
  v_y date := (now() AT TIME ZONE 'UTC')::date - 1;
  v_lo timestamptz := (v_y::timestamp AT TIME ZONE 'UTC');
  v_r1 uuid := 'cccc0000-0000-0000-0000-000000000001';
  v_r2 uuid := 'cccc0000-0000-0000-0000-000000000002';
  v_r3 uuid := 'cccc0000-0000-0000-0000-000000000003';
  v_r4 uuid := 'cccc0000-0000-0000-0000-000000000004';
BEGIN
  INSERT INTO public.rake_records (id, table_id, club_id, is_tournament, source, rake_amount, player_contributions, created_at) VALUES
    (v_r1, 'bbbb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false, 'atomic_distribute_rake', 5.00,
     '{"aaaa0000-0000-0000-0000-000000000001": 50, "aaaa0000-0000-0000-0000-000000000002": 50}'::jsonb, v_lo + interval '2 hours'),
    (v_r2, 'bbbb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false, 'atomic_distribute_rake', 4.00,
     '{"aaaa0000-0000-0000-0000-000000000001": 40}'::jsonb, v_lo + interval '5 hours'),
    -- ClubWithCutoff: v_r3 is BEFORE cutoff (06:00), v_r4 is AFTER cutoff (14:00)
    (v_r3, 'bbbb0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', false, 'atomic_distribute_rake', 3.00,
     '{"aaaa0000-0000-0000-0000-000000000002": 30}'::jsonb, v_lo + interval '6 hours'),
    (v_r4, 'bbbb0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', false, 'atomic_distribute_rake', 6.00,
     '{"aaaa0000-0000-0000-0000-000000000002": 60}'::jsonb, v_lo + interval '14 hours');

  INSERT INTO public.rake_attributions (rake_record_id, club_id, player_id, rake_amount, weighted_rake_credit, created_at) VALUES
    (v_r1, '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 2.50, 2.50, v_lo + interval '2 hours'),
    (v_r1, '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000002', 2.50, 2.50, v_lo + interval '2 hours'),
    -- Late-backfilled attribution created 5 days later (tests window + fallback in fn_ca_reporting_rollups_from_facts!)
    (v_r2, '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 4.00, 4.00, v_lo + interval '5 days'),
    (v_r3, '22222222-2222-2222-2222-222222222222', 'aaaa0000-0000-0000-0000-000000000002', 3.00, 3.00, v_lo + interval '6 hours'),
    (v_r4, '22222222-2222-2222-2222-222222222222', 'aaaa0000-0000-0000-0000-000000000002', 6.00, 6.00, v_lo + interval '14 hours');

  INSERT INTO public.ca_club_data_fact (club_id, stat_date, game_id, kind, user_id, fee, buyins, cashouts, winnings) VALUES
    ('11111111-1111-1111-1111-111111111111', v_y, 'bbbb0000-0000-0000-0000-000000000001', 'CASH', 'aaaa0000-0000-0000-0000-000000000001', 6.50, 100, 120, 20),
    ('11111111-1111-1111-1111-111111111111', v_y, 'bbbb0000-0000-0000-0000-000000000001', 'CASH', 'aaaa0000-0000-0000-0000-000000000002', 2.50, 100, 71, -29),
    ('22222222-2222-2222-2222-222222222222', v_y, 'bbbb0000-0000-0000-0000-000000000002', 'CASH', 'aaaa0000-0000-0000-0000-000000000002', 6.00, 80, 74, -6);
END $$;

-- Job 231 & Job 214 tournaments fixtures
INSERT INTO public.tournaments (id, name, club_id, union_id, status, variant, tournament_type, prize_pool, created_at, ended_at) VALUES
  -- T1: COMPLETED with winner + backed shortfall + house correction
  ('dddd0000-0000-0000-0000-000000000001', 'BackedMTT', '11111111-1111-1111-1111-111111111111', 'fade0000-0000-0000-0000-000000000001', 'COMPLETED', 'nlh', 'MTT', 100, now() - interval '3 days', now() - interval '2 days'),
  -- T2: COMPLETED with entrants & NO winner (must be counted by fn_ca_completed_without_a_champion!)
  ('dddd0000-0000-0000-0000-000000000002', 'NoChampionMTT', '11111111-1111-1111-1111-111111111111', 'fade0000-0000-0000-0000-000000000001', 'COMPLETED', 'nlh', 'MTT', 50, now() - interval '5 days', now() - interval '4 days'),
  -- T3: COMPLETED with 0 entrants (must NOT be counted by fn_ca_completed_without_a_champion)
  ('dddd0000-0000-0000-0000-000000000003', 'EmptyCompleted', '11111111-1111-1111-1111-111111111111', 'fade0000-0000-0000-0000-000000000001', 'COMPLETED', 'nlh', 'MTT', 0, now() - interval '5 days', now() - interval '4 days'),
  -- T4: RUNNING with entrants & no winner (must NOT be counted)
  ('dddd0000-0000-0000-0000-000000000004', 'RunningMTT', '11111111-1111-1111-1111-111111111111', 'fade0000-0000-0000-0000-000000000001', 'RUNNING', 'nlh', 'MTT', 50, now() - interval '1 hour', NULL),
  -- T5: Diamond event (excluded from shortfalls)
  ('dddd0000-0000-0000-0000-000000000005', 'DiamondMTT', '33333333-3333-3333-3333-333333333333', NULL, 'COMPLETED', 'nlh', 'MTT', 100, now() - interval '2 days', now() - interval '1 day');

INSERT INTO public.tournament_players (tournament_id, user_id, status, position) VALUES
  ('dddd0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'winner', 1),
  ('dddd0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000001', 'eliminated', 2),
  ('dddd0000-0000-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-000000000001', 'playing', NULL),
  ('dddd0000-0000-0000-0000-000000000005', 'aaaa0000-0000-0000-0000-000000000001', 'winner', 1);

INSERT INTO public.wallet_transactions (user_id, related_entity_id, type, category, amount, created_at) VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000001', 'debit', 'tournament_buyin', 110, now() - interval '3 days'),
  ('aaaa0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000001', 'credit', 'prize', 80, now() - interval '2 days');
INSERT INTO public.rake_records (tournament_id, is_tournament, rake_amount, created_at) VALUES
  ('dddd0000-0000-0000-0000-000000000001', true, 10, now() - interval '3 days');
INSERT INTO public.chip_ledger (tournament_id, from_type, to_type, category, amount, created_at) VALUES
  ('dddd0000-0000-0000-0000-000000000001', 'union_bank', 'prize_liability', 'correction', 5, now() - interval '2 days');

-- Job 155 & Job 233 BBJ fixtures (epoch pool, late pool, brand-new unbaselined pool, self-moves, cross-pool, non-canonical labels)
INSERT INTO public.ca_chip_baseline (taken_at) VALUES (now() - interval '30 days');
INSERT INTO public.bbj_pools (id, union_id, club_id, status, main_balance, backup_balance, promo_balance, created_at) VALUES
  ('eeee0000-0000-0000-0000-000000000001', 'fade0000-0000-0000-0000-000000000001', NULL, 'active', 150.00, 60.00, 35.00, now() - interval '30 days'),
  ('eeee0000-0000-0000-0000-000000000002', NULL, '11111111-1111-1111-1111-111111111111', 'active', 25.00, 10.00, 5.00, now() - interval '15 days'),
  ('eeee0000-0000-0000-0000-000000000003', NULL, '22222222-2222-2222-2222-222222222222', 'active', 0.00, 0.00, 0.00, now() - interval '2 days');

-- Baselines for pool 1 (epoch) and pool 2 (late); pool 3 has NO baseline yet (tests auto-open!)
INSERT INTO public.ca_bbj_pool_snapshots (pool_id, taken_at, is_baseline, main, backup, promo) VALUES
  ('eeee0000-0000-0000-0000-000000000001', now() - interval '20 days', true, 100.00, 50.00, 20.00),
  ('eeee0000-0000-0000-0000-000000000002', now() - interval '10 days', true, 10.00, 5.00, 0.00);

-- Historical (>6h) + tail (<6h) BBJ ledger legs including self-move & cross-pool & non-canonical label
INSERT INTO public.chip_ledger (club_id, from_type, from_entity_id, from_label, to_type, to_entity_id, to_label, category, amount, created_at) VALUES
  -- Pool 1 old canonical incoming (>6h)
  ('11111111-1111-1111-1111-111111111111', 'player_wallet', 'aaaa0000-0000-0000-0000-000000000001', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', 'bbj_pools.main_balance', 'bbj_contribution', 40.00, now() - interval '12 hours'),
  ('11111111-1111-1111-1111-111111111111', 'player_wallet', 'aaaa0000-0000-0000-0000-000000000001', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', 'bbj_pools.promo_balance', 'bbj_contribution', 15.00, now() - interval '12 hours'),
  -- Pool 1 self-move (main -> backup, two self-legs, one label each!) (>6h)
  ('11111111-1111-1111-1111-111111111111', 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', 'bbj_pools.main_balance', 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', NULL, 'transfer', 10.00, now() - interval '11 hours'),
  ('11111111-1111-1111-1111-111111111111', 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', 'bbj_pools.backup_balance', 'transfer', 10.00, now() - interval '11 hours'),
  -- Pool 1 recent tail (<6h)
  ('11111111-1111-1111-1111-111111111111', 'player_wallet', 'aaaa0000-0000-0000-0000-000000000001', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', 'bbj_pools.main_balance', 'bbj_contribution', 20.00, now() - interval '2 hours'),
  -- Pool 2 absorbed leg (between epoch -20d and opening -10d) + late seed (-8d) + tail seed (-1h)
  ('11111111-1111-1111-1111-111111111111', 'club_treasury', '11111111-1111-1111-1111-111111111111', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000002', 'bbj_pools.main_balance', 'transfer', 10.00, now() - interval '15 days'),
  ('11111111-1111-1111-1111-111111111111', 'club_treasury', '11111111-1111-1111-1111-111111111111', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000002', 'bbj_pools.main_balance', 'transfer', 15.00, now() - interval '8 days'),
  ('11111111-1111-1111-1111-111111111111', 'club_treasury', '11111111-1111-1111-1111-111111111111', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000002', 'bbj_pools.backup_balance', 'transfer', 5.00, now() - interval '1 hour'),
  ('11111111-1111-1111-1111-111111111111', 'club_treasury', '11111111-1111-1111-1111-111111111111', NULL, 'bbj_pool', 'eeee0000-0000-0000-0000-000000000002', 'bbj_pools.promo_balance', 'transfer', 5.00, now() - interval '1 hour');

-- BBJ contributions: pre-triple-bank (NULL portions), old (>6h), tail (<6h), and NULL created_at
INSERT INTO public.bbj_contributions (pool_id, amount, main_portion, backup_portion, promo_portion, created_at) VALUES
  ('eeee0000-0000-0000-0000-000000000001', 100.00, NULL, NULL, NULL, now() - interval '25 days'),
  ('eeee0000-0000-0000-0000-000000000001', 50.00, 30.00, 10.00, 10.00, now() - interval '12 hours'),
  ('eeee0000-0000-0000-0000-000000000001', 25.00, 15.00, 5.00, 5.00, now() - interval '2 hours'),
  ('eeee0000-0000-0000-0000-000000000001', 10.00, 6.00, 2.00, 2.00, NULL);

-- Job 155 fn_rake_bbj_invariants fixtures (I4 flop no drop + I6 mismatch + I8 late)
INSERT INTO public.hand_history (id, table_id, hand_number, rake_amount, bbj_amount, game_variant, players, community_cards, created_at) VALUES
  ('ffff0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', 1001, 2.00, 0, 'NLH', '[{"u":1},{"u":2},{"u":3}]'::jsonb, ARRAY['Ah','Kd','2c'], now() - interval '30 minutes'),
  ('ffff0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001', 1002, 3.00, 1.00, 'NLH', '[{"u":1},{"u":2},{"u":3}]'::jsonb, ARRAY['Ah','Kd','2c'], now() - interval '40 minutes');
INSERT INTO public.rake_records (hand_id, table_id, club_id, is_tournament, source, rake_amount, bbj_contribution, pot_size, num_players, rake_method, player_contributions, created_at) VALUES
  ('ffff0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false, 'atomic_distribute_rake', 2.00, 0, 40.00, 3, 'WEIGHTED_CONTRIBUTED', '{"a":20,"b":20}'::jsonb, now() - interval '20 minutes'),
  ('ffff0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false, 'atomic_distribute_rake', 3.00, 1.00, 60.00, 3, 'WEIGHTED_CONTRIBUTED', '{"a":30,"b":30}'::jsonb, now() - interval '30 minutes');
INSERT INTO public.bbj_contributions (pool_id, hand_id, amount, main_portion, backup_portion, promo_portion, created_at) VALUES
  ('eeee0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000002', 1.00, 0.60, 0.20, 0.20, now() - interval '30 minutes');
INSERT INTO public.rake_attributions (hand_id, club_id, player_id, rake_amount, weighted_rake_credit, created_at) VALUES
  ('ffff0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 2.00, 2.00, now() - interval '20 minutes'),
  ('ffff0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 2.50, 2.50, now() - interval '30 minutes');

-- Job 233 knockout candidates (resolved 30m ago, pending expired on RUNNING, stale pending on COMPLETED)
INSERT INTO public.tournament_knockout_candidates (tournament_id, created_at, rebuy_prompt_until, resolved_at) VALUES
  ('dddd0000-0000-0000-0000-000000000001', now() - interval '40 minutes', NULL, now() - interval '30 minutes'),
  ('dddd0000-0000-0000-0000-000000000004', now() - interval '25 minutes', now() - interval '20 minutes', NULL),
  ('dddd0000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days', NULL);
"""


def reserve_loopback_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return str(s.getsockname()[1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--migration', default=None)
    parser.add_argument('--output', default=None)
    args = parser.parse_args()

    pg_bin = find_pg_bin()
    mig_path = find_migration(args.migration)
    mig_sql = mig_path.read_text()
    preamble_stmts, body_sql = split_migration(mig_sql)
    live_proof = extract_live_proof(mig_sql)

    tmp_base = os.environ.get('SSD_TMPDIR') or tempfile.gettempdir()
    cluster = pathlib.Path(tempfile.mkdtemp(prefix='pg17-cron-perf-', dir=tmp_base))
    data = cluster / 'data'
    pg_log = cluster / 'pg.log'
    port = os.environ.get('CRON_PERF_PG_PORT') or reserve_loopback_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env['LC_ALL'] = 'C'

    results = {'migration': mig_path.name, 'checks': [], 'production_mutations': False}

    def run_cmd(cmd, sql=None, check=True):
        r = subprocess.run([str(c) for c in cmd], input=sql, text=True, capture_output=True, env=env, timeout=120)
        if check and r.returncode != 0:
            log_tail = pg_log.read_text()[-2000:] if pg_log.exists() else ''
            raise RuntimeError(
                f'Command failed ({r.returncode}): {cmd}\nSTDOUT:\n{r.stdout[-3000:]}\nSTDERR:\n{r.stderr[-3000:]}\nPG_LOG:\n{log_tail}'
            )
        return r

    def psql(sql, user='postgres', check=True):
        return run_cmd(
            [pg_bin / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', user, '-d', 'postgres'],
            sql=sql, check=check
        )

    def rec(name, ok, detail=''):
        results['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
        status = 'PASS' if ok else 'FAIL'
        print(f'[{status}] {name}' + (f' ({detail})' if detail else ''), flush=True)
        if not ok:
            raise AssertionError(f'Check failed: {name}: {detail}')

    try:
        run_cmd([pg_bin / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust', '--no-sync', '-E', 'UTF8'])
        run_cmd([
            pg_bin / 'pg_ctl', '-D', data, '-l', pg_log,
            '-o', f'-h 127.0.0.1 -p {port} -c unix_socket_directories="" -c timezone=UTC -c fsync=off -c synchronous_commit=off',
            'start'
        ])

        # 1. Load schema + exact live preimage functions + ACLs
        psql(SCHEMA_SQL)
        for sig, (fname, expected_md5) in PREIMAGES.items():
            fn_sql = (FIX / fname).read_text().strip()
            psql(fn_sql + ';')
            actual_md5 = psql(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()
            rec(f'preimage_md5:{sig}', actual_md5 == expected_md5, f'actual={actual_md5} expected={expected_md5}')
        psql(ACL_SETUP_SQL)
        psql(FIXTURE_SQL)
        psql('ANALYZE;')

        # Capture metadata before migration
        meta_query = """
            SELECT jsonb_object_agg(sig, jsonb_build_object(
              'owner', proowner::regrole::text,
              'secdef', prosecdef,
              'config', proconfig,
              'acl', (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(proacl) x)
            ))
            FROM (VALUES
              ('public.fn_club_rake_rollup_day(uuid,date)'),
              ('public.fn_ca_reporting_rollups_from_facts(date)'),
              ('public.fn_pay_backed_payout_shortfalls(boolean,integer)'),
              ('public.fn_bbj_reconcile(uuid)'),
              ('public.fn_bbj_reconcile_all()'),
              ('public.fn_rake_bbj_invariants(integer)'),
              ('public.fn_union_integrity_sweep(uuid,integer)'),
              ('public.fn_ca_completed_without_a_champion()'),
              ('public.fn_ca_undeclared_money_paths()'),
              ('public.fn_ca_ledger_audit_checkpoint_advance()'),
              ('public.fn_bbj_conservation_check()'),
              ('public.fn_bbj_promo_bank_check()'),
              ('public.fn_ca_knockout_door_stalled(integer)')
            ) t(sig)
            JOIN pg_proc p ON p.oid = t.sig::regprocedure;
        """
        meta_before = json.loads(psql(meta_query).stdout.strip())

        # 2. Snapshot exact preimage behavior for all 13 functions (inside rolled-back read/write snapshot!)
        def capture_behavior(tag):
            snap_sql = r"""
            BEGIN;
            CREATE TEMP TABLE _out (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
            -- Job 128: fn_club_rake_rollup_day (both NULL cutoff & non-NULL cutoff!)
            DO $$
            DECLARE y date := (now() AT TIME ZONE 'UTC')::date - 1; n1 int; n2 int; r jsonb;
            BEGIN
              n1 := public.fn_club_rake_rollup_day('11111111-1111-1111-1111-111111111111', y);
              n2 := public.fn_club_rake_rollup_day('22222222-2222-2222-2222-222222222222', y);
              SELECT jsonb_agg(jsonb_build_object('club', club_id, 'user', user_id, 'rake', rake_amount, 'hands', hands) ORDER BY club_id, user_id)
                INTO r FROM public.club_rake_daily_user WHERE day = y;
              INSERT INTO _out VALUES ('job128_rollup_day', jsonb_build_object('n1', n1, 'n2', n2, 'rows', r));
            END $$;
            -- Job 128: fn_ca_reporting_rollups_from_facts (includes late-backfilled attribution!)
            DO $$
            DECLARE y date := (now() AT TIME ZONE 'UTC')::date - 1; res jsonb; tbl jsonb;
            BEGIN
              res := public.fn_ca_reporting_rollups_from_facts(y);
              SELECT jsonb_agg(jsonb_build_object('club', club_id, 'table', table_id, 'rake', rake, 'hands', hands, 'src', source_rows) ORDER BY club_id, table_id)
                INTO tbl FROM public.club_table_daily WHERE stat_date = y;
              INSERT INTO _out VALUES ('job128_reporting_facts', jsonb_build_object('res', res - 'day', 'tables', tbl));
            END $$;
            -- Job 231: fn_pay_backed_payout_shortfalls
            INSERT INTO _out VALUES ('job231_shortfalls', public.fn_pay_backed_payout_shortfalls(false, 500));
            -- Job 155: fn_rake_bbj_invariants
            INSERT INTO _out VALUES ('job155_invariants', (
              SELECT jsonb_object_agg(check_name, jsonb_build_object('v', violations, 'hands', CASE WHEN jsonb_typeof(detail)='object' THEN detail - 'grace_until' ELSE detail END))
                FROM public.fn_rake_bbj_invariants(2)
            ));
            -- Job 155: fn_bbj_reconcile(pool1)
            DO $$
            DECLARE s public.ca_bbj_pool_snapshots%ROWTYPE;
            BEGIN
              s := public.fn_bbj_reconcile('eeee0000-0000-0000-0000-000000000001');
              INSERT INTO _out VALUES ('job155_reconcile_one', jsonb_build_object(
                'main', s.main, 'backup', s.backup, 'promo', s.promo,
                'jm', s.journal_main, 'jb', s.journal_backup, 'jp', s.journal_promo,
                'drops', s.drops_since, 'payouts', s.payouts_since, 'sweeps', s.sweeps_since,
                'funding', s.funding_since, 'moves', s.moves_since, 'fail', s.write_failures,
                'um', s.unexplained_main, 'ub', s.unexplained_backup, 'up', s.unexplained_promo,
                'basis', s.basis_version
              ));
            END $$;
            -- Job 155: fn_bbj_reconcile_all() (including newly opened pool 3!)
            DO $$
            DECLARE r jsonb; pools jsonb;
            BEGIN
              r := public.fn_bbj_reconcile_all();
              SELECT jsonb_agg(p - 'snapshot_id' ORDER BY p->>'pool_id') INTO pools FROM jsonb_array_elements(r->'pools') p;
              INSERT INTO _out VALUES ('job155_reconcile_all', jsonb_build_object('opened', r->'opened', 'alerts', r->'alerts', 'pools', pools));
            END $$;
            -- Job 123: fn_union_integrity_sweep
            INSERT INTO _out VALUES ('job123_union_sweep', public.fn_union_integrity_sweep('fade0000-0000-0000-0000-000000000001', 24));
            -- Job 214: fn_ca_completed_without_a_champion
            INSERT INTO _out VALUES ('job214_no_champ', to_jsonb(public.fn_ca_completed_without_a_champion()));
            -- Job 214: fn_ca_undeclared_money_paths
            INSERT INTO _out VALUES ('job214_undeclared', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('fn', proname, 'tbl', tbl, 'col', col) ORDER BY proname, tbl, col), '[]'::jsonb)
                FROM public.fn_ca_undeclared_money_paths()
            ));
            -- Job 233: checkpoint advance + bbj_conservation + bbj_promo + knockout_stalled
            DO $$
            DECLARE adv jsonb; c1 jsonb; p1 jsonb; ko jsonb;
            BEGIN
              adv := public.fn_ca_ledger_audit_checkpoint_advance();
              c1 := public.fn_bbj_conservation_check();
              p1 := public.fn_bbj_promo_bank_check();
              SELECT COALESCE(jsonb_agg(jsonb_build_object('pend', pending_candidates, 'past', pending_past_prompt)), '[]'::jsonb)
                INTO ko FROM public.fn_ca_knockout_door_stalled(15);
              INSERT INTO _out VALUES ('job233_bbj_cons', c1 - 'epoch' || jsonb_build_object('epoch', (c1->'epoch') - 'snapshots'));
              INSERT INTO _out VALUES ('job233_bbj_promo', p1);
              INSERT INTO _out VALUES ('job233_ko_stalled', ko);
            END $$;
            SELECT jsonb_object_agg(k, v) FROM _out;
            ROLLBACK;
            """
            out = psql(snap_sql).stdout.strip()
            return json.loads(out)

        before_behavior = capture_behavior('before')
        rec('preimage_fixture_signals_nonzero', (
            before_behavior['job214_no_champ'] == 1
            and len(before_behavior['job214_undeclared']) == 1
            and before_behavior['job214_undeclared'][0]['fn'] == 'zz_test_undeclared_door'
            and len(before_behavior['job123_union_sweep']['direct_chip_transfer']) == 1
            and len(before_behavior['job123_union_sweep']['co_seating']) == 5
            and len(before_behavior['job233_ko_stalled']) == 1
            and before_behavior['job155_reconcile_all']['opened'] == 1
            and before_behavior['job231_shortfalls']['events_paid'] == 1
        ), f"no_champ={before_behavior['job214_no_champ']} undecl={before_behavior['job214_undeclared']} dumps={len(before_behavior['job123_union_sweep']['direct_chip_transfer'])} coseat={len(before_behavior['job123_union_sweep']['co_seating'])} ko={len(before_behavior['job233_ko_stalled'])} opened={before_behavior['job155_reconcile_all']['opened']} paid={before_behavior['job231_shortfalls']['events_paid']}")

        # 3. RED tests: refusal guards
        r_role = psql(body_sql, user='unprivileged_tester', check=False)
        rec('refuses_non_installer_role', r_role.returncode != 0 and 'HOURLY_CRON_PERF_INSTALLER_ROLE' in r_role.stderr)

        r_no_ix = psql(body_sql, check=False)
        rec('refuses_missing_concurrent_indexes', r_no_ix.returncode != 0 and 'HOURLY_CRON_PERF_INDEX_INVALID' in r_no_ix.stderr)

        # Build the 11 CONCURRENTLY indexes outside any transaction (just like apply-recorded-migration.mjs!)
        for stmt in preamble_stmts:
            psql(stmt)
        rec('concurrent_preamble_built', len(preamble_stmts) == len(NEW_INDEXES), f'{len(preamble_stmts)} indexes')

        # Test preimage drift refusal (temporarily alter one function, run body_sql, assert refusal, restore)
        drift_test = """
        BEGIN;
        CREATE OR REPLACE FUNCTION public.fn_ca_completed_without_a_champion() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$ SELECT 42 $$;
        COMMIT;
        """
        psql(drift_test)
        r_drift = psql(body_sql, check=False)
        rec('refuses_drifted_preimage', r_drift.returncode != 0 and 'HOURLY_CRON_PERF_PREIMAGE_DRIFT' in r_drift.stderr)
        # Restore exact preimage + ACL
        psql((FIX / 'fn_ca_completed_without_a_champion.sql').read_text().strip() + ';')
        psql('REVOKE ALL ON FUNCTION public.fn_ca_completed_without_a_champion() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.fn_ca_completed_without_a_champion() TO service_role;')

        # 4. Apply migration body verbatim (including all 13 @probe-for blocks!)
        psql(body_sql)
        rec('migration_applied_verbatim', True)

        # 5. Live proof assertion
        lp_res = psql(f'SELECT ({live_proof})::text;').stdout.strip()
        rec('live_proof_true', lp_res == 'true', f'result={lp_res}')

        # 6. Metadata preservation
        meta_after = json.loads(psql(meta_query).stdout.strip())
        rec('metadata_and_acls_preserved', meta_after == meta_before, 'owner/secdef/proconfig/proacl identical across all 13 functions')

        # 7. Idempotent re-apply
        for stmt in preamble_stmts:
            psql(stmt)
        psql(body_sql)
        meta_reapply = json.loads(psql(meta_query).stdout.strip())
        rec('idempotent_reapply', meta_reapply == meta_before)

        # 8. Exact output equivalence BEFORE checkpoint advance AND AFTER checkpoint advance!
        after_behavior = capture_behavior('after_cold')
        for k in sorted(before_behavior.keys()):
            rec(f'exact_equivalence_cold:{k}', after_behavior[k] == before_behavior[k],
                '' if after_behavior[k] == before_behavior[k] else f'\nBEFORE={before_behavior[k]}\nAFTER ={after_behavior[k]}')

        # Advance checkpoints permanently, then add NEW tail rows (after horizon) and re-check parity!
        psql('SELECT public.fn_ca_ledger_audit_checkpoint_advance();')
        psql('SELECT public.fn_bbj_reconcile_all();')
        after_warm = capture_behavior('after_warm')
        for k in ['job128_rollup_day', 'job128_reporting_facts', 'job231_shortfalls', 'job155_invariants',
                  'job123_union_sweep', 'job214_no_champ', 'job214_undeclared', 'job233_bbj_cons',
                  'job233_bbj_promo', 'job233_ko_stalled']:
            rec(f'exact_equivalence_warm:{k}', after_warm[k] == before_behavior[k],
                '' if after_warm[k] == before_behavior[k] else f'\nBEFORE={before_behavior[k]}\nAFTER ={after_warm[k]}')

        # Verify incremental 2nd advance of ca_bbj_reconcile_marks and ca_bbj_promo_audit_mark with new rows
        psql("""
        INSERT INTO public.bbj_contributions (pool_id, amount, main_portion, backup_portion, promo_portion, created_at)
        VALUES ('eeee0000-0000-0000-0000-000000000001', 20.00, 12.00, 4.00, 4.00, now() - interval '1 hour');
        """)
        promo_with_mark = json.loads(psql('SELECT public.fn_bbj_promo_bank_check();').stdout.strip())
        # Compare against raw sum without mark (inside rolled-back tx deleting mark)
        promo_raw = json.loads(psql('BEGIN; DELETE FROM public.ca_bbj_promo_audit_mark; SELECT public.fn_bbj_promo_bank_check(); ROLLBACK;').stdout.strip())
        rec('bbj_promo_checkpoint_equals_raw_after_tail_insert', promo_with_mark == promo_raw)

        # Verify fn_bbj_reconcile matches full uncheckpointed sum after new tail leg + baseline reset
        psql("""
        INSERT INTO public.chip_ledger (club_id, from_type, from_entity_id, to_type, to_entity_id, to_label, category, amount, created_at)
        VALUES ('11111111-1111-1111-1111-111111111111', 'player_wallet', 'aaaa0000-0000-0000-0000-000000000001',
                'bbj_pool', 'eeee0000-0000-0000-0000-000000000001', 'bbj_pools.main_balance', 'bbj_contribution', 7.50, now() - interval '30 minutes');
        """)
        rec_with_mark = json.loads(psql("BEGIN; SELECT jsonb_build_object('jm', journal_main, 'jb', journal_backup, 'jp', journal_promo, 'um', unexplained_main) FROM public.fn_bbj_reconcile('eeee0000-0000-0000-0000-000000000001'); ROLLBACK;").stdout.strip())
        rec_raw = json.loads(psql("BEGIN; DELETE FROM public.ca_bbj_reconcile_marks; SELECT jsonb_build_object('jm', journal_main, 'jb', journal_backup, 'jp', journal_promo, 'um', unexplained_main) FROM public.fn_bbj_reconcile('eeee0000-0000-0000-0000-000000000001'); ROLLBACK;").stdout.strip())
        rec('bbj_reconcile_checkpoint_equals_raw_after_tail_insert', rec_with_mark == rec_raw, f'{rec_with_mark}')

        # 9. EXPLAIN index-usage verification for all 11 new indexes (enable_seqscan=off proves every index matches its target query predicate!)
        psql('ANALYZE;')
        index_probes = {
            'idx_chip_ledger_house_corrections_by_tournament':
                "SELECT tournament_id, amount FROM public.chip_ledger WHERE tournament_id IS NOT NULL AND category = 'correction' AND to_type = 'prize_liability' AND from_type IN ('union_bank','club_treasury')",
            'idx_table_seats_joined_at_cover':
                "SELECT user_id, table_id FROM public.table_seats WHERE joined_at >= now() - interval '24 hours'",
            'idx_tournaments_completed_id':
                "SELECT id FROM public.tournaments WHERE status = 'COMPLETED'",
            'idx_tournament_players_winner_tid':
                "SELECT tournament_id FROM public.tournament_players WHERE status = 'winner'",
            'idx_bbj_contributions_created_at_cover':
                "SELECT amount, promo_portion FROM public.bbj_contributions WHERE created_at >= now() - interval '6 hours'",
            'idx_tournaments_private_union':
                "SELECT id FROM public.tournaments WHERE COALESCE(is_private, false) AND union_id IS NOT NULL",
            'idx_tables_private_union':
                "SELECT id FROM public.tables WHERE COALESCE(is_private, false) AND union_id IS NOT NULL",
            'idx_tables_live_union_club_mismatch':
                "SELECT id FROM public.tables WHERE union_id IS NOT NULL AND COALESCE(is_private, false) = false AND club_id IS DISTINCT FROM union_id AND COALESCE(is_deleted, false) = false AND status NOT IN ('closed','deleted')",
            'idx_tournament_knockout_candidates_pending_unresolved':
                "SELECT tournament_id FROM public.tournament_knockout_candidates WHERE resolved_at IS NULL",
            'idx_tournament_knockout_candidates_resolved_at':
                "SELECT max(resolved_at) FROM public.tournament_knockout_candidates WHERE resolved_at IS NOT NULL",
            'idx_ca_ledger_write_failures_occurred_at':
                "SELECT count(*) FROM public.ca_ledger_write_failures WHERE occurred_at > now() - interval '1 hour'",
        }
        for ix, q_sql in index_probes.items():
            plan = psql(f'BEGIN; SET LOCAL enable_seqscan = off; EXPLAIN {q_sql}; ROLLBACK;').stdout
            rec(f'explain_uses_index:{ix}', ix in plan, '' if ix in plan else plan[:300])

        if args.output:
            out_path = pathlib.Path(args.output)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(results, indent=2) + '\n')

        print(f"\nALL {len(results['checks'])} NATIVE PG17 CHECKS PASSED!")
    finally:
        subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'],
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(cluster, ignore_errors=True)


if __name__ == '__main__':
    main()
