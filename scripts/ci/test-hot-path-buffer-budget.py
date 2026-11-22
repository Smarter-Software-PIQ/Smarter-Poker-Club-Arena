#!/usr/bin/env python3
"""Guardrail #3: Hot-Path EXPLAIN (ANALYZE, BUFFERS) PostgreSQL 17 Budget Gate.

Boots a fresh isolated PostgreSQL 17 cluster, seeds 5,000+ historical rows into
each hot history table (hand_state_snapshots, chip_transactions,
tournament_bounties, tournament_bounty_obligations, tournament_players,
tournament_knockout_candidates, hand_submissions, f06_hand_permits,
hand_submission_dispositions), loads the current authoritative SQL definitions
for the hot tournament/hand-path functions from
scripts/ci/fixtures/rebuy-off-tournament-row/preimages.json + migration
20261119175856_a_rebuy_never_blocks_a_hand_commit_on_the_tournament_row.sql,
and runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) inside rolled-back
transactions to enforce strict upper bounds on:
  1. Total shared buffer hits + reads (proving index / index-only access rather
     than sequential scans over 5,000+ historical rows),
  2. Zero Seq Scan nodes on large history tables,
  3. Execution time well within budget.

Also executes negative self-tests (intentionally unindexed Seq Scan queries
against the same 6,000-row history tables) proving the budget checker fails
hard when a sequential scan or buffer explosion occurs.

Usage:
  PG_BIN=/usr/lib/postgresql/17/bin python3 scripts/ci/test-hot-path-buffer-budget.py
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin python3 scripts/ci/test-hot-path-buffer-budget.py
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261119175856_a_rebuy_never_blocks_a_hand_commit_on_the_tournament_row.sql'
PREIMAGES = ROOT / 'scripts/ci/fixtures/rebuy-off-tournament-row/preimages.json'

LARGE_HISTORY_TABLES = frozenset({
    'hand_state_snapshots',
    'chip_transactions',
    'tournament_bounties',
    'tournament_bounty_obligations',
    'tournament_players',
    'tournament_knockout_candidates',
    'hand_submissions',
    'f06_hand_permits',
    'hand_submission_dispositions',
})

SEED_SNAPSHOT_ROWS = 6000
SEED_CHIP_TX_ROWS = 6000
SEED_HISTORY_ROWS = 5500

TR = '00000000-0000-0000-0000-000000000011'
TBL_A = '00000000-0000-0000-0000-000000000021'
TBL_B = '00000000-0000-0000-0000-000000000022'
LEASE_GEN = '00000000-0000-0000-0000-000000000031'
HAND_ID_1 = '00000000-0000-0000-0000-000000000041'
HAND_ID_2 = '00000000-0000-0000-0000-000000000042'
PERMIT_1 = '00000000-0000-0000-0000-000000000051'
USER_1 = '00000000-0000-0000-0000-000000000061'
USER_2 = '00000000-0000-0000-0000-000000000062'
CLUB_1 = '00000000-0000-0000-0000-000000000071'


def resolve_pg_bin() -> Path:
    candidates = []
    if os.environ.get('PG_BIN'):
        candidates.append(Path(os.environ['PG_BIN']))
    candidates.extend([
        Path('/usr/lib/postgresql/17/bin'),
        Path('/opt/homebrew/opt/postgresql@17/bin'),
        Path('/opt/homebrew/bin'),
        Path('/usr/lib/postgresql/16/bin'),
    ])
    for cand in candidates:
        if (cand / 'initdb').exists() and (cand / 'pg_ctl').exists() and (cand / 'psql').exists():
            return cand
    sys.exit(
        'PostgreSQL 17 binaries not found (checked PG_BIN, /usr/lib/postgresql/17/bin, '
        '/opt/homebrew/opt/postgresql@17/bin, /opt/homebrew/bin); set PG_BIN'
    )


def walk_plan_nodes(node):
    yield node
    for child in node.get('Plans', []):
        yield from walk_plan_nodes(child)


def evaluate_explain_budget(
    explain_doc,
    *,
    label: str,
    max_shared_buffers: int,
    max_execution_ms: float,
    forbid_seq_scan_tables=LARGE_HISTORY_TABLES,
):
    """Evaluate EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) against hard budgets.

    Returns (ok, violations, metrics) without raising so negative self-tests can
    assert that regressions are reliably caught.
    """
    top = explain_doc[0]
    plan = top['Plan']
    shared_hit = int(plan.get('Shared Hit Blocks', 0))
    shared_read = int(plan.get('Shared Read Blocks', 0))
    total_buffers = shared_hit + shared_read
    execution_ms = float(top.get('Execution Time', 0.0))

    seq_scans = []
    scan_nodes = []
    for node in walk_plan_nodes(plan):
        ntype = node.get('Node Type', '')
        rel = node.get('Relation Name')
        if rel:
            scan_nodes.append(f"{ntype}({rel})")
        if ntype == 'Seq Scan' and rel in forbid_seq_scan_tables:
            seq_scans.append(rel)

    violations = []
    if seq_scans:
        violations.append(f"forbidden Seq Scan on {sorted(set(seq_scans))}")
    if total_buffers > max_shared_buffers:
        violations.append(
            f"shared buffers {total_buffers} (hit={shared_hit}, read={shared_read}) "
            f"exceeded budget {max_shared_buffers}"
        )
    if execution_ms > max_execution_ms:
        violations.append(
            f"execution time {execution_ms:.3f}ms exceeded budget {max_execution_ms:.1f}ms"
        )

    metrics = {
        'label': label,
        'shared_hit_blocks': shared_hit,
        'shared_read_blocks': shared_read,
        'total_shared_buffers': total_buffers,
        'max_shared_buffers': max_shared_buffers,
        'execution_time_ms': round(execution_ms, 3),
        'max_execution_ms': max_execution_ms,
        'seq_scans': sorted(set(seq_scans)),
        'scan_nodes': scan_nodes,
    }
    return (len(violations) == 0), violations, metrics


SCHEMA_SQL = f"""
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA smarter_private;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION extensions.digest(bytea, text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5($1::text), 'hex') $$;

CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY,
  name text DEFAULT 'Midday Free Buy',
  club_id uuid DEFAULT '{CLUB_1}'::uuid,
  union_id uuid,
  status text NOT NULL DEFAULT 'RUNNING',
  max_players integer DEFAULT 100,
  started_at timestamptz DEFAULT now(),
  prize_pool numeric DEFAULT 1000,
  bounty_pool numeric DEFAULT 500,
  bounty_pool_paid numeric DEFAULT 0,
  total_rake numeric DEFAULT 50,
  is_bounty boolean DEFAULT true,
  is_pko boolean DEFAULT true,
  is_mystery_bounty boolean DEFAULT false,
  bounty_amount numeric DEFAULT 50,
  prize_pool_finalized boolean DEFAULT false
);

CREATE TABLE public.tournament_launch_receipts(
  tournament_id uuid PRIMARY KEY,
  launch_id uuid DEFAULT gen_random_uuid(),
  lease_generation uuid DEFAULT '{LEASE_GEN}'::uuid,
  completed_at timestamptz DEFAULT now()
);

CREATE TABLE public.tables(
  id uuid PRIMARY KEY,
  tournament_id uuid REFERENCES public.tournaments(id),
  current_players integer DEFAULT 6
);

CREATE TABLE public.engine_tournament_leases(
  tournament_id uuid PRIMARY KEY,
  instance_id text NOT NULL,
  lease_generation uuid NOT NULL,
  protocol_version integer NOT NULL DEFAULT 2,
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.engine_table_leases(
  table_id uuid PRIMARY KEY,
  instance_id text NOT NULL,
  lease_generation uuid NOT NULL,
  protocol_version integer NOT NULL DEFAULT 2,
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.table_seats(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL,
  user_id uuid NOT NULL,
  seat_number integer NOT NULL DEFAULT 1,
  left_at timestamptz
);
CREATE INDEX idx_table_seats_table_user_active ON public.table_seats(table_id, user_id) WHERE left_at IS NULL;

CREATE TABLE public.ca_operator_floor_hold(
  operation_id uuid PRIMARY KEY,
  mode text NOT NULL
);
CREATE TABLE public.ca_launch_operator_scopes(
  operation_id uuid PRIMARY KEY,
  club_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[]
);

CREATE TABLE public.tournament_players(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  user_id uuid NOT NULL,
  club_id uuid NOT NULL DEFAULT '{CLUB_1}'::uuid,
  status text NOT NULL DEFAULT 'playing',
  chips numeric NOT NULL DEFAULT 10000,
  rebuys integer NOT NULL DEFAULT 0,
  add_on boolean NOT NULL DEFAULT false,
  registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tourn_players_tourn ON public.tournament_players(tournament_id);
CREATE INDEX idx_tourn_players_user ON public.tournament_players(user_id);
CREATE INDEX idx_tournament_players_tourn_user ON public.tournament_players(tournament_id, user_id);
CREATE INDEX idx_tournament_players_chips_rebuilt ON public.tournament_players(tournament_id, status, chips);

CREATE TABLE public.hand_state_snapshots(
  id uuid PRIMARY KEY,
  table_id uuid NOT NULL,
  hand_number integer NOT NULL,
  is_complete boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  state_json jsonb NOT NULL
);
CREATE INDEX idx_hand_state_snapshots_table_hand ON public.hand_state_snapshots(table_id, hand_number);
CREATE UNIQUE INDEX idx_hand_snapshots_one_active_per_table ON public.hand_state_snapshots(table_id) WHERE NOT is_complete;
CREATE INDEX idx_hand_state_snapshots_retention_cover ON public.hand_state_snapshots(created_at, id) INCLUDE (table_id, hand_number);

CREATE TABLE public.chip_transactions(
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL,
  transaction_type text NOT NULL,
  from_user_id uuid,
  to_user_id uuid NOT NULL,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{{}}'::jsonb
);
CREATE INDEX idx_chip_tx_type_user_created ON public.chip_transactions(transaction_type, to_user_id, created_at);
CREATE INDEX idx_chip_transactions_club ON public.chip_transactions(club_id);

CREATE TABLE public.tournament_bounties(
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  collector_player_id uuid NOT NULL,
  eliminated_player_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 25,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tourney_bounties_tournament ON public.tournament_bounties(tournament_id);
CREATE INDEX idx_tourney_bounties_collector ON public.tournament_bounties(collector_player_id);
CREATE INDEX idx_tourney_bounties_eliminated ON public.tournament_bounties(eliminated_player_id);

CREATE TABLE public.tournament_bounty_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  eliminated_user_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'pko',
  status text NOT NULL DEFAULT 'pending',
  claimants jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tbo_tournament_eliminated ON public.tournament_bounty_obligations(tournament_id, eliminated_user_id);

CREATE TABLE public.tournament_knockout_candidates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,
  eliminated_user_id uuid NOT NULL,
  hand_number bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tkc_tournament_eliminated ON public.tournament_knockout_candidates(tournament_id, eliminated_user_id);

CREATE TABLE public.hand_atomic_commits(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid,
  hand_number bigint,
  hand_id uuid
);
CREATE INDEX idx_hand_atomic_commits_table_hand ON public.hand_atomic_commits(table_id, hand_number);

CREATE TABLE smarter_private.hand_submissions(
  submission_id uuid PRIMARY KEY,
  table_id uuid NOT NULL,
  hand_number bigint NOT NULL,
  tournament_id uuid,
  permit_id uuid,
  instance_id text NOT NULL,
  lease_generation uuid NOT NULL,
  request jsonb NOT NULL,
  request_hash text NOT NULL,
  UNIQUE(table_id, hand_number)
);
CREATE TABLE smarter_private.f06_hand_permits(
  permit_id uuid PRIMARY KEY,
  table_id uuid NOT NULL,
  hand_number bigint NOT NULL,
  tournament_id uuid,
  state text NOT NULL DEFAULT 'reserved',
  generation uuid NOT NULL
);
CREATE INDEX idx_f06_hand_permits_table_hand ON smarter_private.f06_hand_permits(table_id, hand_number);

CREATE TABLE smarter_private.hand_submission_dispositions(
  table_id uuid NOT NULL,
  hand_number bigint NOT NULL,
  permit_id uuid,
  disposition text NOT NULL,
  submission_id uuid NOT NULL,
  PRIMARY KEY(table_id, hand_number)
);
CREATE TABLE smarter_private.hand_continuations(
  table_id uuid,
  hand_number bigint,
  tournament_id uuid,
  permit_id uuid,
  original_generation uuid,
  writer_generation uuid,
  payload jsonb
);

-- Minimal stubs required by authoritative hot-path functions in isolation.
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_engine_lease_stale_seconds() RETURNS integer LANGUAGE sql AS $$ SELECT 60 $$;
CREATE FUNCTION public.fn_ca_share_settlement_lane_for_table(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION smarter_private.assert_retained_hand_submission(jsonb) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_fee_state_ensure(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_daily_window_entry_refusal(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.fn_ca_new_tournament_starts_blocked() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_lock_daily_mission_user(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_share_tournament_lane_for_rebuy(uuid, uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ca:tournament-rebuy-lane:v1:' || $1::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1', 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1:' || $1::text, 0));
  PERFORM set_config('ca.tournament_rebuy_lane', $1::text || ':' || COALESCE($2::text, '') || ':' || txid_current()::text, true);
END $$;
CREATE FUNCTION smarter_private.tournament_rebuy_lane_held(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT COALESCE(split_part(current_setting('ca.tournament_rebuy_lane', true), ':', 1), '') = $1::text
$$;
CREATE FUNCTION smarter_private.tournament_bounty_claimant_tables(uuid, uuid, jsonb DEFAULT NULL) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT ARRAY[]::uuid[]
$$;
CREATE FUNCTION public.fn_ca_commit_hand_settlement_before_lease_generation(
  uuid, bigint, jsonb, numeric, numeric, text, numeric, jsonb, jsonb
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('success', true, 'atomic_hand_commit', true)
$$;
"""

SEED_SQL = f"""
-- Core tournament/table rows
INSERT INTO public.tournaments(id)
SELECT md5('tr-' || i)::uuid FROM generate_series(1, 500) i;
INSERT INTO public.tournaments(id) VALUES ('{TR}');

INSERT INTO public.tournament_launch_receipts(tournament_id)
SELECT md5('tr-' || i)::uuid FROM generate_series(1, 500) i;
INSERT INTO public.tournament_launch_receipts(tournament_id) VALUES ('{TR}');

INSERT INTO public.tables(id, tournament_id)
SELECT md5('tbl-' || i)::uuid, md5('tr-' || i)::uuid FROM generate_series(1, 500) i;
INSERT INTO public.tables(id, tournament_id) VALUES ('{TBL_A}', '{TR}'), ('{TBL_B}', '{TR}');

INSERT INTO public.engine_tournament_leases(tournament_id, instance_id, lease_generation, protocol_version, heartbeat_at)
SELECT md5('tr-' || i)::uuid, 'inst-bg', md5('lg-' || i)::uuid, 2, clock_timestamp()
FROM generate_series(1, 500) i;
INSERT INTO public.engine_tournament_leases(tournament_id, instance_id, lease_generation, protocol_version, heartbeat_at)
VALUES ('{TR}', 'inst-1', '{LEASE_GEN}', 2, clock_timestamp());

-- 6,000 historical hand_state_snapshots rows (padded JSONB so any Seq Scan blows buffer budget)
INSERT INTO public.hand_state_snapshots(id, table_id, hand_number, is_complete, created_at, state_json)
SELECT
  md5('snap-' || i)::uuid,
  md5('tbl-' || ((i % 500) + 1))::uuid,
  i,
  true,
  now() - make_interval(secs => (6001 - i)),
  jsonb_build_object('stage', 'showdown', 'padding', repeat('x', 500))
FROM generate_series(1, {SEED_SNAPSHOT_ROWS}) i;

INSERT INTO public.hand_state_snapshots(id, table_id, hand_number, is_complete, created_at, state_json)
VALUES
  (md5('snap-target-done')::uuid, '{TBL_B}', 101, true, now() - interval '5 seconds', jsonb_build_object('stage', 'showdown', 'padding', repeat('x', 500))),
  (md5('snap-target-active')::uuid, '{TBL_B}', 102, false, now(), jsonb_build_object('stage', 'flop', 'padding', repeat('x', 500)));

-- 6,000 historical chip_transactions rows
INSERT INTO public.chip_transactions(id, club_id, transaction_type, from_user_id, to_user_id, amount, created_at, metadata)
SELECT
  md5('ctx-' || i)::uuid,
  '{CLUB_1}'::uuid,
  CASE WHEN i % 3 = 0 THEN 'rebuy' WHEN i % 3 = 1 THEN 'bounty_payout' ELSE 'hand_settlement' END,
  md5('from-' || (i % 500))::uuid,
  md5('user-' || (i % 1000))::uuid,
  (i % 200) + 10,
  now() - make_interval(secs => (6001 - i)),
  jsonb_build_object('audit_tag', 'hist', 'padding', repeat('c', 400))
FROM generate_series(1, {SEED_CHIP_TX_ROWS}) i;

INSERT INTO public.chip_transactions(id, club_id, transaction_type, from_user_id, to_user_id, amount, created_at, metadata)
VALUES (md5('ctx-target')::uuid, '{CLUB_1}'::uuid, 'rebuy', NULL, '{USER_1}'::uuid, 100, now(), jsonb_build_object('audit_tag', 'target'));

-- 5,500 historical tournament_bounties rows
INSERT INTO public.tournament_bounties(id, tournament_id, collector_player_id, eliminated_player_id, amount, created_at)
SELECT
  md5('bty-' || i)::uuid,
  md5('tr-' || ((i % 500) + 1))::uuid,
  md5('col-' || (i % 1000))::uuid,
  md5('elim-' || i)::uuid,
  25,
  now() - make_interval(secs => (5501 - i))
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;

INSERT INTO public.tournament_bounties(id, tournament_id, collector_player_id, eliminated_player_id, amount, created_at)
VALUES (md5('bty-target')::uuid, '{TR}', '{USER_1}', '{USER_2}', 50, now());

-- 5,500 historical tournament_bounty_obligations rows (two obligations for USER_2 -> fast clean refusal path in fn_collect_bounty after index lookup)
INSERT INTO public.tournament_bounty_obligations(id, tournament_id, eliminated_user_id, mode, status)
SELECT
  md5('tbo-' || i)::uuid,
  md5('tr-' || ((i % 500) + 1))::uuid,
  md5('elim-' || i)::uuid,
  'pko',
  'settled'
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;

INSERT INTO public.tournament_bounty_obligations(id, tournament_id, eliminated_user_id, mode, status)
VALUES
  (md5('tbo-target-1')::uuid, '{TR}', '{USER_2}', 'pko', 'pending'),
  (md5('tbo-target-2')::uuid, '{TR}', '{USER_2}', 'pko', 'pending');

-- 5,500 historical tournament_players rows
INSERT INTO public.tournament_players(id, tournament_id, user_id, club_id, status, chips, rebuys)
SELECT
  md5('tp-' || i)::uuid,
  md5('tr-' || ((i % 500) + 1))::uuid,
  md5('user-' || i)::uuid,
  '{CLUB_1}'::uuid,
  CASE WHEN i % 4 = 0 THEN 'eliminated' ELSE 'playing' END,
  10000 + (i % 5000),
  i % 3
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;

INSERT INTO public.tournament_players(id, tournament_id, user_id, club_id, status, chips, rebuys)
VALUES (md5('tp-target-1')::uuid, '{TR}', '{USER_1}', '{CLUB_1}', 'playing', 15000, 1);

-- 5,500 historical tournament_knockout_candidates rows
INSERT INTO public.tournament_knockout_candidates(id, tournament_id, eliminated_user_id, hand_number)
SELECT
  md5('tkc-' || i)::uuid,
  md5('tr-' || ((i % 500) + 1))::uuid,
  md5('elim-' || i)::uuid,
  1000000 + i
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;

-- 5,500 historical hand_submissions, f06_hand_permits, hand_submission_dispositions rows
INSERT INTO smarter_private.hand_submissions(submission_id, table_id, hand_number, tournament_id, permit_id, instance_id, lease_generation, request, request_hash)
SELECT
  md5('sub-' || i)::uuid,
  md5('tbl-' || ((i % 500) + 1))::uuid,
  i,
  md5('tr-' || ((i % 500) + 1))::uuid,
  md5('prm-' || i)::uuid,
  'inst-bg',
  md5('lg-' || ((i % 500) + 1))::uuid,
  jsonb_build_object('padding', repeat('r', 200)),
  md5('req-' || i)
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;

INSERT INTO smarter_private.f06_hand_permits(permit_id, table_id, hand_number, tournament_id, state, generation)
SELECT
  md5('prm-' || i)::uuid,
  md5('tbl-' || ((i % 500) + 1))::uuid,
  i,
  md5('tr-' || ((i % 500) + 1))::uuid,
  'committed',
  md5('lg-' || ((i % 500) + 1))::uuid
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;

INSERT INTO smarter_private.f06_hand_permits(permit_id, table_id, hand_number, tournament_id, state, generation)
VALUES ('{PERMIT_1}', '{TBL_B}', 101, '{TR}', 'reserved', '{LEASE_GEN}');

INSERT INTO smarter_private.hand_submission_dispositions(table_id, hand_number, permit_id, disposition, submission_id)
SELECT
  md5('tbl-' || ((i % 500) + 1))::uuid,
  i,
  md5('prm-' || i)::uuid,
  'committed',
  md5('sub-' || i)::uuid
FROM generate_series(1, {SEED_HISTORY_ROWS}) i;
"""


def main():
    parser = argparse.ArgumentParser(description='Hot-Path EXPLAIN (ANALYZE, BUFFERS) PG17 Budget Gate')
    parser.add_argument('--scratch', type=Path, default=None, help='Optional parent directory for PG17 temp cluster')
    parser.add_argument('--output', type=Path, default=None, help='Optional JSON report output path')
    args = parser.parse_args()

    pg = resolve_pg_bin()
    if args.scratch is not None:
        args.scratch.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix='g2-', dir=args.scratch))
    else:
        tmp = Path(tempfile.mkdtemp(prefix='g2-'))

    data = tmp / 'd'
    sock = tmp
    assert len(str(sock / '.s.PGSQL.55461').encode()) < 103, (
        f'Unix socket path too long for macOS/Linux (max 103 bytes): {sock / ".s.PGSQL.55461"}'
    )

    as_user = []
    if os.geteuid() == 0:
        as_user = ['runuser', '-u', 'postgres', '--']
        subprocess.run(['chown', '-R', 'postgres', str(tmp)], check=True)

    def run(*cmd):
        r = subprocess.run(as_user + [str(x) for x in cmd], capture_output=True, text=True)
        if r.returncode != 0:
            pg_log = (tmp / 'pg.log').read_text() if (tmp / 'pg.log').exists() else ''
            raise AssertionError(
                f'Command failed (rc={r.returncode}): {cmd}\nstderr:\n{r.stderr}\npg.log:\n{pg_log}'
            )
        return r

    started = False
    try:
        run(pg / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync')
        with open(data / 'postgresql.conf', 'a') as f:
            f.write(
                f"\nlisten_addresses=''\n"
                f"unix_socket_directories='{sock}'\n"
                f"port=55461\n"
                f"shared_buffers='64MB'\n"
                f"random_page_cost=1.1\n"
                f"fsync=off\n"
                f"synchronous_commit=off\n"
                f"full_page_writes=off\n"
            )
        run(pg / 'pg_ctl', '-D', data, '-l', tmp / 'pg.log', '-w', 'start')
        started = True

        def psql(sql=None, file=None, ok=True):
            r = subprocess.run(
                as_user + [
                    str(pg / 'psql'), '-h', str(sock), '-p', '55461', '-U', 'postgres',
                    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
                ] + (['-f', str(file)] if file else ['-c', sql]),
                capture_output=True,
                text=True,
            )
            if ok and r.returncode != 0:
                raise AssertionError(f'psql failed:\n{r.stderr}\nSQL: {(sql or file)!s:.400}')
            return r

        def explain_json(query_sql: str, preamble_sql: str = '', warm_same_session: bool = False):
            warm_block = (
                f"BEGIN;\n{preamble_sql}\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {query_sql};\nROLLBACK;\n"
                if warm_same_session
                else ''
            )
            wrapped = (
                f"{warm_block}"
                f"BEGIN;\n"
                f"{preamble_sql}\n"
                f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {query_sql};\n"
                f"ROLLBACK;"
            )
            out = psql(wrapped).stdout.strip()
            # When warm_same_session=True, psql outputs two JSON arrays; take the second (steady-state) plan.
            if warm_same_session:
                marker = out.rfind('\n[')
                start = marker + 1 if marker != -1 else out.find('[')
            else:
                start = out.find('[')
            end = out.rfind(']')
            if start == -1 or end == -1:
                raise AssertionError(f'EXPLAIN did not return JSON: {out[:400]}')
            return json.loads(out[start:end + 1])

        # 1. Install schema, seed 5,500-6,000 rows per hot table, and load authoritative functions
        psql(SCHEMA_SQL)
        psql(SEED_SQL)
        psql('VACUUM ANALYZE;')

        preimages = json.loads(PREIMAGES.read_text())['functions']
        for fn in preimages:
            psql(fn['definition'])
        psql(file=MIGRATION)

        checks = 0
        report = {'positive': [], 'negative_self_tests': []}

        def check_positive(label: str, query_sql: str, *, max_buffers: int, max_ms: float, preamble_sql: str = ''):
            nonlocal checks
            # Warm once in the same backend session so PL/pgSQL catalog/plan cache reflects steady-state pooled traffic
            doc = explain_json(query_sql, preamble_sql=preamble_sql, warm_same_session=True)
            ok, violations, metrics = evaluate_explain_budget(
                doc,
                label=label,
                max_shared_buffers=max_buffers,
                max_execution_ms=max_ms,
            )
            report['positive'].append(metrics)
            if not ok:
                raise AssertionError(
                    f"BUDGET VIOLATION [{label}]: {'; '.join(violations)} | metrics={json.dumps(metrics)}"
                )
            checks += 1
            print(
                f"PASS [{checks}] {label}: buffers={metrics['total_shared_buffers']}/{max_buffers} "
                f"(hit={metrics['shared_hit_blocks']}, read={metrics['shared_read_blocks']}), "
                f"time={metrics['execution_time_ms']:.3f}ms/{max_ms:.1f}ms, "
                f"scans={metrics['scan_nodes'] or ['PL/pgSQL']}",
                flush=True,
            )

        def check_negative(label: str, query_sql: str, *, max_buffers: int, max_ms: float, expected_table: str):
            nonlocal checks
            doc = explain_json(query_sql)
            ok, violations, metrics = evaluate_explain_budget(
                doc,
                label=label,
                max_shared_buffers=max_buffers,
                max_execution_ms=max_ms,
            )
            report['negative_self_tests'].append({**metrics, 'caught': not ok, 'violations': violations})
            if ok:
                raise AssertionError(
                    f"NEGATIVE SELF-TEST FAILED [{label}]: budget checker unexpectedly PASSED an unindexed "
                    f"seq-scan query! metrics={json.dumps(metrics)}"
                )
            if expected_table not in metrics['seq_scans']:
                raise AssertionError(
                    f"NEGATIVE SELF-TEST FAILED [{label}]: expected Seq Scan on {expected_table}, "
                    f"got seq_scans={metrics['seq_scans']} violations={violations}"
                )
            if metrics['total_shared_buffers'] <= max_buffers:
                raise AssertionError(
                    f"NEGATIVE SELF-TEST FAILED [{label}]: expected buffer explosion > {max_buffers}, "
                    f"got {metrics['total_shared_buffers']}"
                )
            checks += 1
            print(
                f"PASS [{checks}] NEGATIVE SELF-TEST [{label}]: reliably REJECTED "
                f"(seq_scans={metrics['seq_scans']}, buffers={metrics['total_shared_buffers']} > {max_buffers})",
                flush=True,
            )

        # 2. Hot-path indexed query plan checks (over 5,500 - 6,000 historical rows)
        check_positive(
            'hand_state_snapshots point lookup (table_id, hand_number)',
            f"SELECT id, is_complete FROM public.hand_state_snapshots WHERE table_id = '{TBL_B}'::uuid AND hand_number = 101",
            max_buffers=25,
            max_ms=25.0,
        )
        check_positive(
            'hand_state_snapshots active hand lookup (partial unique index)',
            f"SELECT id, hand_number FROM public.hand_state_snapshots WHERE table_id = '{TBL_B}'::uuid AND NOT is_complete",
            max_buffers=25,
            max_ms=25.0,
        )
        check_positive(
            'hand_state_snapshots bounded retention cover scan (LIMIT 100)',
            "SELECT id, table_id, hand_number FROM public.hand_state_snapshots ORDER BY created_at, id LIMIT 100",
            max_buffers=30,
            max_ms=25.0,
        )
        check_positive(
            'chip_transactions player recent ledger lookup (LIMIT 20)',
            f"SELECT id, amount, created_at FROM public.chip_transactions "
            f"WHERE transaction_type = 'rebuy' AND to_user_id = '{USER_1}'::uuid "
            f"ORDER BY created_at DESC LIMIT 20",
            max_buffers=30,
            max_ms=25.0,
        )
        check_positive(
            'tournament_bounties per-eliminated lookup',
            f"SELECT id, collector_player_id, amount FROM public.tournament_bounties "
            f"WHERE tournament_id = '{TR}'::uuid AND eliminated_player_id = '{USER_2}'::uuid",
            max_buffers=30,
            max_ms=25.0,
        )
        check_positive(
            'tournament_players active seat/rebuy status lookup',
            f"SELECT id, status, chips FROM public.tournament_players "
            f"WHERE tournament_id = '{TR}'::uuid AND user_id = '{USER_1}'::uuid AND status IN ('registered', 'playing')",
            max_buffers=25,
            max_ms=25.0,
        )

        # 3. Authoritative hot-path PL/pgSQL function execution checks (post-20261119175856)
        check_positive(
            'fn_ca_commit_hand_settlement_exact_before_obligations (authoritative)',
            f"SELECT public.fn_ca_commit_hand_settlement_exact_before_obligations("
            f"'{TBL_B}'::uuid, 101, '[]'::jsonb, 0, 0, 'ref-budget-101', 0, "
            f"'{{}}'::jsonb, '[]'::jsonb, 'inst-1', '{LEASE_GEN}'::uuid)",
            max_buffers=60,
            max_ms=50.0,
        )

        retain_req = json.dumps({
            'p_bbj': 0,
            'p_hand_number': 101,
            'p_hand_row': {'id': HAND_ID_1, 'table_id': TBL_B, 'hand_number': 101},
            'p_inflow': 0,
            'p_instance_id': 'inst-1',
            'p_lease_generation': LEASE_GEN,
            'p_post_commit_obligations': {},
            'p_rake': 0,
            'p_ref': 'ref-budget-101',
            'p_stacks': [],
            'p_table_id': TBL_B,
            'p_units': [],
        })
        check_positive(
            'fn_ca_retain_hand_submission (authoritative post-20261119175856)',
            f"SELECT public.fn_ca_retain_hand_submission('{retain_req}'::jsonb)",
            max_buffers=80,
            max_ms=50.0,
        )

        check_positive(
            'fn_ca_lock_tournament_rebuy_acquisition (authoritative)',
            f"SELECT public.fn_ca_lock_tournament_rebuy_acquisition('{TR}'::uuid, '{USER_1}'::uuid, '{TBL_A}'::uuid)",
            preamble_sql=f"SELECT public.fn_ca_share_tournament_lane_for_rebuy('{TR}'::uuid, '{USER_1}'::uuid);",
            max_buffers=60,
            max_ms=50.0,
        )

        check_positive(
            'fn_collect_bounty (authoritative over 5,500 obligations)',
            f"SELECT public.fn_collect_bounty('{TR}'::uuid, '{USER_2}'::uuid, '{USER_1}'::uuid, NULL::jsonb)",
            max_buffers=80,
            max_ms=50.0,
        )

        # 4. Negative self-tests: intentionally unindexed Seq Scans MUST fail the budget gate
        check_negative(
            'unindexed JSONB scan on 6,000-row hand_state_snapshots',
            "SELECT id FROM public.hand_state_snapshots WHERE state_json->>'stage' = 'river'",
            max_buffers=25,
            max_ms=25.0,
            expected_table='hand_state_snapshots',
        )
        check_negative(
            'unindexed JSONB scan on 6,000-row chip_transactions',
            "SELECT id FROM public.chip_transactions WHERE metadata->>'audit_tag' = 'unindexed_probe'",
            max_buffers=30,
            max_ms=25.0,
            expected_table='chip_transactions',
        )

        if args.output is not None:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + '\n')

        print(f'ALL {checks} HOT-PATH BUFFER BUDGET CHECKS PASSED', flush=True)
    finally:
        if started:
            subprocess.run(
                as_user + [str(pg / 'pg_ctl'), '-D', str(data), '-m', 'fast', 'stop'],
                capture_output=True,
            )
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
