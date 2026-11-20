#!/usr/bin/env python3
"""A rebuy never blocks a hand commit on the tournament row (incident 075013fd, lag-finish lane 3).

Native PostgreSQL 16/17 proof for migration
20261119175856_a_rebuy_never_blocks_a_hand_commit_on_the_tournament_row.sql.

Loads all 10 md5-pinned production pre-images from
scripts/ci/fixtures/rebuy-off-tournament-row/preimages.json, proves:
  1. BEFORE migration: a held rebuy (FOR UPDATE + pool UPDATE) blocks a
     concurrent hand commit (FOR SHARE) and hand retain (FOR SHARE) on an
     unrelated table for the entire rebuy duration.
  2. Migration installs cleanly in one transaction, all 7 @probe-for probes
     execute and unwind cleanly, @live-proof evaluates true, and a second
     apply is refused atomically by the pre-image guard.
  3. AFTER migration: a held rebuy (FOR NO KEY UPDATE + launch-proof parent
     lock + prize_pool/bounty_pool/total_rake/bounty_pool_paid UPDATE) does
     NOT block a concurrent hand commit or hand retain on an unrelated table.
  4. SAFETY: terminal/lifecycle FOR UPDATE on tournaments STILL blocks both
     hand commits (FOR KEY SHARE) and rebuys (FOR NO KEY UPDATE).
  5. SAFETY: two concurrent rebuy pool updates STILL serialize on FOR NO KEY
     UPDATE with exact prize_pool conservation (no lost updates).
  6. SAFETY: same-table hand commit vs rebuy serializes on tables FOR UPDATE
     with zero deadlocks.

Usage: PG_BIN=/opt/homebrew/bin python3 scripts/ci/test-a-rebuy-never-blocks-a-hand-commit-on-the-tournament-row.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119175856_*.sql'))
FIX = ROOT / 'scripts/ci/fixtures/rebuy-off-tournament-row/preimages.json'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
if not (PG / 'initdb').exists() and Path('/opt/homebrew/bin/initdb').exists():
    PG = Path('/opt/homebrew/bin')

HOLD_SEC = 0.55
TR = '00000000-0000-0000-0000-000000000011'
TBL_A = '00000000-0000-0000-0000-000000000021'
TBL_B = '00000000-0000-0000-0000-000000000022'
LEASE_GEN = '00000000-0000-0000-0000-000000000031'
HAND_ID_1 = '00000000-0000-0000-0000-000000000041'
HAND_ID_2 = '00000000-0000-0000-0000-000000000042'
PERMIT_1 = '00000000-0000-0000-0000-000000000051'
PERMIT_2 = '00000000-0000-0000-0000-000000000052'
USER_1 = '00000000-0000-0000-0000-000000000061'

SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA smarter_private;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION extensions.digest(bytea, text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5($1::text), 'hex') $$;

CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY,
  name text DEFAULT 'Midday Free Buy',
  club_id uuid DEFAULT gen_random_uuid(),
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
CREATE TABLE public.tournament_players(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid,
  user_id uuid,
  club_id uuid,
  status text DEFAULT 'playing'
);
CREATE TABLE public.tournament_knockout_candidates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, left_at timestamptz);
CREATE TABLE public.hand_atomic_commits(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.tournament_bounty_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid,
  table_id uuid,
  hand_id uuid,
  hand_number bigint,
  eliminated_user_id uuid,
  state text,
  claimants jsonb
);
CREATE TABLE public.entry_purchase_idempotency_receipts(
  key_domain text NOT NULL,
  idempotency_key text NOT NULL,
  request jsonb NOT NULL,
  response jsonb,
  claimed_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY(key_domain, idempotency_key)
);
CREATE TABLE public.ca_promo_play_through_settings(id boolean PRIMARY KEY, enforced_from timestamptz);
CREATE TABLE public.ca_promo_play_through_grants(id uuid PRIMARY KEY, club_id uuid, user_id uuid, closed_at timestamptz);
CREATE TABLE smarter_private.hand_submissions(
  submission_id uuid PRIMARY KEY,
  table_id uuid NOT NULL,
  hand_number bigint NOT NULL,
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

-- Minimal stubs required by the probes and hand-commit / retain calls.
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_engine_lease_stale_seconds() RETURNS integer LANGUAGE sql AS $$ SELECT 60 $$;
CREATE FUNCTION public.fn_ca_share_settlement_lane_for_table(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION smarter_private.assert_retained_hand_submission(jsonb) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_fee_state_ensure(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
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

INSERT INTO public.tournaments(id) VALUES('{TR}');
INSERT INTO public.tournament_launch_receipts(tournament_id) VALUES('{TR}');
INSERT INTO public.tables(id, tournament_id) VALUES('{TBL_A}', '{TR}'), ('{TBL_B}', '{TR}');
INSERT INTO public.engine_tournament_leases(tournament_id, instance_id, lease_generation, protocol_version, heartbeat_at)
  VALUES('{TR}', 'inst-1', '{LEASE_GEN}', 2, clock_timestamp());
INSERT INTO smarter_private.f06_hand_permits(permit_id, table_id, hand_number, tournament_id, state, generation)
  VALUES('{PERMIT_1}', '{TBL_B}', 101, '{TR}', 'reserved', '{LEASE_GEN}'),
        ('{PERMIT_2}', '{TBL_B}', 102, '{TR}', 'reserved', '{LEASE_GEN}');
"""


def main():
    if not (PG / 'initdb').exists():
        sys.exit(f'PostgreSQL binaries not found at {PG}; set PG_BIN')
    fix = json.loads(FIX.read_text())['functions']
    tmp = Path(tempfile.mkdtemp(prefix='rebuy-trow-'))
    data, sock = tmp / 'data', tmp / 'sock'
    sock.mkdir()
    as_user = []
    if os.geteuid() == 0:
        as_user = ['runuser', '-u', 'postgres', '--']
        subprocess.run(['chown', '-R', 'postgres', str(tmp)], check=True)
    run = lambda *a: subprocess.run(as_user + [str(x) for x in a], check=True, capture_output=True, text=True)
    run(PG / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust')
    with open(data / 'postgresql.conf', 'a') as f:
        f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nport=55459\ndeadlock_timeout='200ms'\n")
    run(PG / 'pg_ctl', '-D', data, '-l', tmp / 'log', '-w', 'start')

    def psql(sql=None, file=None, ok=True):
        r = subprocess.run(
            as_user + [str(PG / 'psql'), '-h', str(sock), '-p', '55459', '-U', 'postgres',
                       '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
            + (['-f', str(file)] if file else ['-c', sql]),
            capture_output=True, text=True
        )
        if ok and r.returncode != 0:
            raise AssertionError(f'psql failed: {r.stderr}\n{(sql or file)!s:.400}')
        return r

    checks = 0

    def check(label, cond):
        nonlocal checks
        if not cond:
            raise AssertionError(f'FAILED: {label}')
        checks += 1
        print(f'PASS [{checks}] {label}', flush=True)

    def hand_commit_sql(tbl, hn):
        return f"""
        SELECT public.fn_ca_commit_hand_settlement_exact_before_obligations(
          '{tbl}'::uuid, {hn}, '[]'::jsonb, 0, 0, 'ref-{hn}', 0,
          '{{}}'::jsonb, '[]'::jsonb, 'inst-1', '{LEASE_GEN}'::uuid
        )->>'success';
        """

    def retain_sql(tbl, hn, sid):
        req = json.dumps({
            'p_bbj': 0,
            'p_hand_number': hn,
            'p_hand_row': {'id': sid, 'table_id': tbl, 'hand_number': hn},
            'p_inflow': 0,
            'p_instance_id': 'inst-1',
            'p_lease_generation': LEASE_GEN,
            'p_post_commit_obligations': {},
            'p_rake': 0,
            'p_ref': f'ref-{hn}',
            'p_stacks': [],
            'p_table_id': tbl,
            'p_units': [],
        })
        return f"SELECT public.fn_ca_retain_hand_submission('{req}'::jsonb)->>'retained';"

    def race_holder_vs_runner(holder_sql, runner_sql):
        """Start holder_sql (which sleeps HOLD_SEC while holding locks), wait 120ms, then run runner_sql and measure elapsed."""
        holder_err = []
        holder_started = threading.Event()

        def do_holder():
            holder_started.set()
            r = psql(holder_sql, ok=False)
            if r.returncode != 0:
                holder_err.append(r.stderr)

        t = threading.Thread(target=do_holder)
        t.start()
        holder_started.wait()
        time.sleep(0.15)
        t0 = time.monotonic()
        r = psql(runner_sql, ok=False)
        elapsed = time.monotonic() - t0
        t.join()
        if holder_err:
            raise AssertionError(f'holder failed: {holder_err[0]}')
        return elapsed, r

    try:
        psql(SCHEMA)
        for fn in fix:
            psql(fn['definition'])
            actual = psql(f"SELECT md5(pg_get_functiondef('{fn['signature']}'::regprocedure))").stdout.strip()
            check(f"pre-image md5 matches for {fn['signature'].split('(')[0]}", actual == fn['md5'])

        # 1. BEFORE MIGRATION (post-20261119181500 state):
        #    (a) fn_claim_bounty_legacy_candidate_20260907 STILL takes FOR UPDATE
        #        on public.tournaments, blocking a FOR KEY SHARE hand commit on Table B.
        #    (b) fn_ca_retain_hand_submission STILL takes FOR SHARE on public.tournaments,
        #        blocking behind a FOR NO KEY UPDATE rebuy on Table A.
        bounty_claim_before = f"""
        BEGIN;
        SELECT public.fn_claim_bounty_legacy_candidate_20260907(
          '{TR}'::uuid, '{USER_1}'::uuid, 2, 0, '{TBL_A}'::uuid, '{HAND_ID_1}'::uuid,
          1000001::bigint, now(), NULL::uuid, NULL::jsonb, 0, false);
        SELECT pg_sleep({HOLD_SEC});
        COMMIT;
        """
        el_commit_before, r_cb = race_holder_vs_runner(bounty_claim_before, hand_commit_sql(TBL_B, 1))
        check(f'BEFORE: hand commit on unrelated Table B waited behind bounty-claim FOR UPDATE ({el_commit_before:.3f}s >= 0.30s)',
              r_cb.returncode == 0 and r_cb.stdout.strip() == 'true' and el_commit_before >= 0.30)

        rebuy_noku = f"""
        BEGIN;
        SELECT public.fn_ca_share_tournament_lane_for_tables('{TR}'::uuid, '{USER_1}'::uuid, ARRAY['{TBL_A}']::uuid[]);
        SELECT * FROM public.fn_lock_tournament_launch_proof_parents(ARRAY['{TR}']::uuid[]);
        UPDATE public.tournaments SET prize_pool = prize_pool + 100 WHERE id = '{TR}';
        SELECT pg_sleep({HOLD_SEC});
        COMMIT;
        """
        el_retain_before, r_rb = race_holder_vs_runner(rebuy_noku, retain_sql(TBL_B, 101, HAND_ID_1))
        check(f'BEFORE: hand retain on unrelated Table B waited behind rebuy FOR NO KEY UPDATE ({el_retain_before:.3f}s >= 0.30s; rc={r_rb.returncode} err={r_rb.stderr.strip()})',
              r_rb.returncode == 0 and r_rb.stdout.strip() == 'true' and el_retain_before >= 0.30)

        # 2. APPLY MIGRATION
        psql(file=MIGRATION)
        check('migration applied cleanly (including @probe-for and 20261119181500 prerequisite guard)', True)

        # Verify @live-proof evaluates true
        mig_text = MIGRATION.read_text()
        live_proof = re.search(r'^-- @live-proof: (.+)$', mig_text, re.M).group(1)
        lp_out = psql(f'SELECT ({live_proof})::text;').stdout.strip()
        check('@live-proof evaluates true after install', lp_out == 'true')

        # Verify second apply is refused atomically by pre-image guard
        r_dup = psql(file=MIGRATION, ok=False)
        check('second apply refused atomically by pre-image guard',
              r_dup.returncode != 0 and 'pre-image drifted' in r_dup.stderr)

        # 3. AFTER MIGRATION: held bounty rebuy (fn_ca_share_tournament_lane_for_tables +
        #    fn_lock_tournament_launch_proof_parents + fn_claim_bounty_legacy_candidate_20260907
        #    + pool UPDATE) does NOT block hand commit or retain on Table B!
        rebuy_after = f"""
        BEGIN;
        SELECT public.fn_ca_share_tournament_lane_for_tables('{TR}'::uuid, '{USER_1}'::uuid, ARRAY['{TBL_A}']::uuid[]);
        SELECT * FROM public.fn_lock_tournament_launch_proof_parents(ARRAY['{TR}']::uuid[]);
        SELECT public.fn_claim_bounty_legacy_candidate_20260907(
          '{TR}'::uuid, '{USER_1}'::uuid, 2, 0, '{TBL_A}'::uuid, '{HAND_ID_2}'::uuid,
          1000002::bigint, now(), NULL::uuid, NULL::jsonb, 0, false);
        UPDATE public.tournaments
           SET prize_pool = prize_pool + 100,
               bounty_pool = bounty_pool + 50,
               total_rake = total_rake + 10,
               bounty_pool_paid = bounty_pool_paid + 25
         WHERE id = '{TR}';
        SELECT pg_sleep({HOLD_SEC});
        COMMIT;
        """
        el_commit_after, r_ca = race_holder_vs_runner(rebuy_after, hand_commit_sql(TBL_B, 2))
        check(f'AFTER: hand commit on unrelated Table B does NOT wait ({el_commit_after:.3f}s < 0.20s)',
              r_ca.returncode == 0 and r_ca.stdout.strip() == 'true' and el_commit_after < 0.20)

        el_retain_after, r_ra = race_holder_vs_runner(rebuy_after, retain_sql(TBL_B, 102, HAND_ID_2))
        check(f'AFTER: hand retain on unrelated Table B does NOT wait ({el_retain_after:.3f}s < 0.20s; rc={r_ra.returncode} err={r_ra.stderr.strip()})',
              r_ra.returncode == 0 and r_ra.stdout.strip() == 'true' and el_retain_after < 0.20)

        # 4. SAFETY: terminal/lifecycle FOR UPDATE STILL blocks hand commit (FOR KEY SHARE) AND rebuy (FOR NO KEY UPDATE)
        lifecycle_hold = f"""
        BEGIN;
        SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR UPDATE;
        SELECT pg_sleep({HOLD_SEC});
        COMMIT;
        """
        el_life_hand, r_lh = race_holder_vs_runner(lifecycle_hold, hand_commit_sql(TBL_B, 3))
        check(f'SAFETY: lifecycle FOR UPDATE still blocks hand commit ({el_life_hand:.3f}s >= 0.30s)',
              r_lh.returncode == 0 and r_lh.stdout.strip() == 'true' and el_life_hand >= 0.30)

        rebuy_probe = f"""
        BEGIN;
        SELECT * FROM public.fn_lock_tournament_launch_proof_parents(ARRAY['{TR}']::uuid[]);
        COMMIT;
        """
        el_life_rebuy, r_lr = race_holder_vs_runner(lifecycle_hold, rebuy_probe)
        check(f'SAFETY: lifecycle FOR UPDATE still blocks rebuy FOR NO KEY UPDATE ({el_life_rebuy:.3f}s >= 0.30s)',
              r_lr.returncode == 0 and el_life_rebuy >= 0.30)

        # 5. SAFETY: two concurrent rebuy pool updates serialize with exact conservation
        pool_before = float(psql(f"SELECT prize_pool FROM public.tournaments WHERE id = '{TR}';").stdout.strip())
        upd_1 = f"""
        BEGIN;
        SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR NO KEY UPDATE;
        UPDATE public.tournaments SET prize_pool = prize_pool + 75 WHERE id = '{TR}';
        SELECT pg_sleep(0.30);
        COMMIT;
        """
        upd_2 = f"""
        BEGIN;
        SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR NO KEY UPDATE;
        UPDATE public.tournaments SET prize_pool = prize_pool + 125 WHERE id = '{TR}';
        COMMIT;
        """
        el_ser, r_ser = race_holder_vs_runner(upd_1, upd_2)
        pool_after = float(psql(f"SELECT prize_pool FROM public.tournaments WHERE id = '{TR}';").stdout.strip())
        check(f'SAFETY: concurrent pool writers serialize ({el_ser:.3f}s >= 0.10s) and conserve chips ({pool_before} -> {pool_after})',
              r_ser.returncode == 0 and el_ser >= 0.10 and abs(pool_after - (pool_before + 200)) < 1e-6)

        # 6. SAFETY: same-table race (rebuy on Table A vs hand commit on Table A) serializes with 0 deadlocks
        el_same, r_same = race_holder_vs_runner(rebuy_after, hand_commit_sql(TBL_A, 4))
        check(f'SAFETY: same-table hand commit vs rebuy serializes cleanly with 0 deadlocks ({el_same:.3f}s >= 0.30s)',
              r_same.returncode == 0 and r_same.stdout.strip() == 'true' and el_same >= 0.30)

        print(f'ALL {checks} CHECKS PASSED', flush=True)
    finally:
        subprocess.run(as_user + [str(PG / 'pg_ctl'), '-D', str(data), '-m', 'fast', 'stop'], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
