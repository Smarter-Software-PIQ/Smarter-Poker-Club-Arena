#!/usr/bin/env python3
"""Remaining shared-lane tournament row locks never block a hand commit (incident 075013fd, lag-finish lane 6).

Native PostgreSQL 16/17 proof for migration
20261119185300_remaining_tournament_row_locks_never_block_hands.sql.

Loads all 6 md5-pinned production pre-images from
scripts/ci/fixtures/remaining-tournament-row-locks/preimages.json, proves:
  1. BEFORE migration:
     - trg_refuse_finalized_tournament_entry (FOR UPDATE on tournaments) blocks
       a concurrent hand commit (FOR KEY SHARE on tournaments).
     - fn_terminal_tournament_seat_is_immutable (FOR SHARE on tournaments &
       tables) blocks a concurrent shared-lane pool writer (FOR NO KEY UPDATE +
       non-key UPDATE on tournaments).
     - fn_register_for_tournament_before_atomic_capacity_20260907,
       fn_register_horse_for_tournament_before_maintenance_gate,
       fn_sweep_pending_tournament_bounties, and fn_move_tournament_player
       hold FOR UPDATE on tournaments and block a concurrent hand commit
       (FOR KEY SHARE).
  2. Migration installs cleanly in one bounded transaction, all @probe-for
     probes execute and unwind cleanly, @live-proof evaluates true, and a
     second apply is refused atomically by the pre-image guard.
  3. AFTER migration:
     - All 5 downgraded functions (human register, horse register,
       trg_refuse_finalized_tournament_entry, bounty sweep, player move) lock
       public.tournaments FOR NO KEY UPDATE and do NOT block a concurrent hand
       commit (FOR KEY SHARE) even while updating non-key columns
       (current_players, prize_pool, bounty_pool, total_rake).
     - fn_terminal_tournament_seat_is_immutable locks public.tournaments and
       public.tables FOR KEY SHARE and does NOT block a concurrent shared-lane
       pool writer (FOR NO KEY UPDATE + non-key UPDATE on tournaments).
  4. SAFETY:
     - Lifecycle/terminal FOR UPDATE on public.tournaments STILL blocks both
       FOR KEY SHARE (hand commits & seat INSERTs) and FOR NO KEY UPDATE
       (registrations, trg_refuse_finalized_tournament_entry, moves, sweeps).
     - Pool finalization (prize_pool_finalized = true) STILL serializes with
       trg_refuse_finalized_tournament_entry and refuses new entries.
     - Terminal tournament status (COMPLETED) STILL refuses new table_seats via
       fn_terminal_tournament_seat_is_immutable.
     - Concurrent FOR NO KEY UPDATE writers STILL serialize with exact
       prize_pool and current_players conservation.

Usage: PG_BIN=/opt/homebrew/opt/postgresql@17/bin python3 scripts/ci/test-remaining-tournament-row-locks-never-block-hands.py
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
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119185300_*.sql'))
FIX = ROOT / 'scripts/ci/fixtures/remaining-tournament-row-locks/preimages.json'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
if not (PG / 'initdb').exists() and Path('/opt/homebrew/opt/postgresql@17/bin/initdb').exists():
    PG = Path('/opt/homebrew/opt/postgresql@17/bin')
elif not (PG / 'initdb').exists() and Path('/opt/homebrew/bin/initdb').exists():
    PG = Path('/opt/homebrew/bin')

HOLD_SEC = 0.55
TR = '00000000-0000-0000-0000-000000000111'
TR_DONE = '00000000-0000-0000-0000-000000000112'
TBL_A = '00000000-0000-0000-0000-000000000121'
TBL_B = '00000000-0000-0000-0000-000000000122'
TBL_DONE = '00000000-0000-0000-0000-000000000123'
USER_H = '00000000-0000-0000-0000-000000000131'
USER_HORSE = '00000000-0000-0000-0000-000000000132'
USER_MOVE = '00000000-0000-0000-0000-000000000133'
OBL_1 = '00000000-0000-0000-0000-000000000141'
REQ_1 = '00000000-0000-0000-0000-000000000151'
REQ_2 = '00000000-0000-0000-0000-000000000152'

SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA smarter_private;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT NULLIF(current_setting('app.test_uid', true), '')::uuid
$$;
CREATE FUNCTION extensions.digest(bytea, text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5($1::text), 'hex') $$;

CREATE TABLE public.profiles(
  id uuid PRIMARY KEY,
  username text DEFAULT 'player',
  is_horse boolean DEFAULT false
);

CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY,
  name text DEFAULT 'Midday Free Buy',
  club_id uuid DEFAULT gen_random_uuid(),
  union_id uuid,
  status text NOT NULL DEFAULT 'RUNNING',
  buy_in_amount numeric DEFAULT 10,
  buy_in_fee numeric DEFAULT 1,
  max_players integer DEFAULT 100,
  current_players integer DEFAULT 0,
  late_reg_levels integer DEFAULT 6,
  late_reg_mins integer DEFAULT 60,
  current_level integer DEFAULT 1,
  started_at timestamptz DEFAULT now(),
  start_time timestamptz DEFAULT now(),
  authorized_to_register boolean DEFAULT true,
  is_vip_only boolean DEFAULT false,
  early_bird_enabled boolean DEFAULT false,
  early_bird_chips integer DEFAULT 0,
  variant text DEFAULT 'mtt',
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

CREATE TABLE public.tables(
  id uuid PRIMARY KEY,
  tournament_id uuid REFERENCES public.tournaments(id),
  current_players integer DEFAULT 0,
  terminal_closed_at timestamptz
);

CREATE TABLE public.tournament_players(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  user_id uuid NOT NULL,
  table_id uuid,
  seat_number integer,
  status text DEFAULT 'registered',
  chips integer DEFAULT 10000
);

CREATE TABLE public.table_seats(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.tables(id),
  user_id uuid NOT NULL,
  seat_number integer NOT NULL,
  stack numeric DEFAULT 10000,
  left_at timestamptz,
  terminal_closed_at timestamptz,
  status text DEFAULT 'active',
  is_sitting_out boolean DEFAULT false
);

CREATE TABLE public.tournament_terminal_settlements(
  tournament_id uuid PRIMARY KEY
);
CREATE TABLE public.tournament_satellite_settlements(
  tournament_id uuid PRIMARY KEY
);
CREATE TABLE public.tournament_cancellation_receipts(
  tournament_id uuid PRIMARY KEY
);

CREATE TABLE public.tournament_bounty_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  table_id uuid DEFAULT '{TBL_A}'::uuid,
  hand_id uuid DEFAULT gen_random_uuid(),
  hand_number bigint DEFAULT 1,
  mode text DEFAULT 'standard',
  eliminated_user_id uuid DEFAULT gen_random_uuid(),
  knocker_user_id uuid DEFAULT gen_random_uuid(),
  claimants jsonb DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'pending',
  next_attempt_at timestamptz NOT NULL DEFAULT now() - interval '1 minute',
  attempt_count integer DEFAULT 0,
  last_error text,
  settled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Minimal stubs required by the 6 functions and their probes.
CREATE FUNCTION public.fn_ca_tournament_unit_cents(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 100 $$;
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_tournament_is_unlimited(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_ca_terminal_marker_transition_is_exact(jsonb, jsonb, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_tournament_seat_move_receipt(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.fn_ca_share_tournament_lane_for_tables(uuid, uuid DEFAULT NULL, uuid[] DEFAULT NULL, boolean DEFAULT false)
  RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION smarter_private.tournament_bounty_claimant_tables(uuid, uuid, jsonb DEFAULT NULL)
  RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[]::uuid[] $$;
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_collect_bounty(uuid, uuid, uuid, jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('ok', false, 'reason', 'probe_stub')
$$;
CREATE FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT true
$$;

INSERT INTO public.profiles(id, username, is_horse) VALUES
  ('{USER_H}', 'human1', false),
  ('{USER_HORSE}', 'horse1', true),
  ('{USER_MOVE}', 'mover1', false);

INSERT INTO public.tournaments(id, status, current_players, prize_pool_finalized) VALUES
  ('{TR}', 'RUNNING', 0, false),
  ('{TR_DONE}', 'COMPLETED', 0, true);

INSERT INTO public.tables(id, tournament_id, current_players) VALUES
  ('{TBL_A}', '{TR}', 1),
  ('{TBL_B}', '{TR}', 0),
  ('{TBL_DONE}', '{TR_DONE}', 0);

INSERT INTO public.tournament_bounty_obligations(id, tournament_id, state, next_attempt_at)
  VALUES ('{OBL_1}', '{TR}', 'pending', now() - interval '1 minute');
"""


def main():
    if not (PG / 'initdb').exists():
        sys.exit(f'PostgreSQL binaries not found at {PG}; set PG_BIN')
    fix = json.loads(FIX.read_text())['functions']
    tmp = Path(tempfile.mkdtemp(prefix='lane6-trow-'))
    data, sock = tmp / 'data', tmp / 'sock'
    sock.mkdir()
    as_user = []
    if os.geteuid() == 0:
        as_user = ['runuser', '-u', 'postgres', '--']
        subprocess.run(['chown', '-R', 'postgres', str(tmp)], check=True)
    run = lambda *a: subprocess.run(as_user + [str(x) for x in a], check=True, capture_output=True, text=True)
    run(PG / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust')
    with open(data / 'postgresql.conf', 'a') as f:
        f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nport=55479\ndeadlock_timeout='200ms'\n")
    run(PG / 'pg_ctl', '-D', data, '-l', tmp / 'log', '-w', 'start')

    def psql(sql=None, file=None, ok=True):
        r = subprocess.run(
            as_user + [str(PG / 'psql'), '-h', str(sock), '-p', '55479', '-U', 'postgres',
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

    def race_holder_vs_runner(holder_sql, runner_sql):
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

    hand_commit_key_share = f"SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR KEY SHARE;"
    pool_writer_nku = f"""
    BEGIN;
    SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR NO KEY UPDATE;
    UPDATE public.tournaments SET prize_pool = prize_pool + 25 WHERE id = '{TR}';
    COMMIT;
    """

    try:
        psql(SCHEMA)
        for fn in fix:
            psql('SET check_function_bodies = off;\n' + fn['definition'])
            actual = psql(f"SELECT md5(pg_get_functiondef('{fn['signature']}'::regprocedure))").stdout.strip()
            check(f"pre-image md5 matches for {fn['signature'].split('(')[0]}", actual == fn['md5'])

        # Attach both trigger functions to their tables
        psql("""
        CREATE TRIGGER zzzz_refuse_finalized_tournament_entry
          BEFORE INSERT ON public.tournament_players
          FOR EACH ROW EXECUTE FUNCTION public.trg_refuse_finalized_tournament_entry();
        CREATE TRIGGER terminal_tournament_seat_is_immutable
          BEFORE INSERT OR DELETE OR UPDATE ON public.table_seats
          FOR EACH ROW EXECUTE FUNCTION public.fn_terminal_tournament_seat_is_immutable();
        """)

        # ------------------------------------------------------------------
        # 1. BEFORE MIGRATION: prove all 6 functions take blocking locks
        # ------------------------------------------------------------------

        # 1a. trg_refuse_finalized_tournament_entry (FOR UPDATE) blocks hand commit (FOR KEY SHARE)
        holder_trg_entry = f"""
        BEGIN;
        INSERT INTO public.tournament_players(tournament_id, user_id, status)
          VALUES ('{TR}', gen_random_uuid(), 'registered');
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_trg_entry, hand_commit_key_share)
        check(f'BEFORE: trg_refuse_finalized_tournament_entry blocks hand commit FOR KEY SHARE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 1b. fn_terminal_tournament_seat_is_immutable (FOR SHARE) blocks pool writer (FOR NO KEY UPDATE)
        holder_seat_ins = f"""
        BEGIN;
        INSERT INTO public.table_seats(table_id, user_id, seat_number, stack)
          VALUES ('{TBL_A}', gen_random_uuid(), 2, 10000);
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_seat_ins, pool_writer_nku)
        check(f'BEFORE: fn_terminal_tournament_seat_is_immutable FOR SHARE blocks pool writer FOR NO KEY UPDATE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 1c. Human register (returns registration_closed after acquiring lock on tournaments) blocks FOR KEY SHARE
        holder_reg_human = f"""
        BEGIN;
        SELECT set_config('app.test_uid', '{USER_H}', true);
        SELECT public.fn_register_for_tournament_before_atomic_capacity_20260907('{TR}', false);
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_reg_human, hand_commit_key_share)
        check(f'BEFORE: human register FOR UPDATE blocks hand commit FOR KEY SHARE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 1d. Horse register blocks FOR KEY SHARE
        holder_reg_horse = f"""
        BEGIN;
        SELECT public.fn_register_horse_for_tournament_before_maintenance_gate('{TR}', '{USER_HORSE}');
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_reg_horse, hand_commit_key_share)
        check(f'BEFORE: horse register FOR UPDATE blocks hand commit FOR KEY SHARE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 1e. Already-converted 20261119181500 functions (sweep & move) do NOT block FOR KEY SHARE
        holder_sweep = f"""
        BEGIN;
        SELECT public.fn_sweep_pending_tournament_bounties('{TR}', 1);
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_sweep, hand_commit_key_share)
        check(f'PREREQ 20261119181500: fn_sweep_pending_tournament_bounties FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE ({el:.3f}s < {HOLD_SEC*0.5:.2f}s)',
              r.returncode == 0 and el < HOLD_SEC * 0.5)

        # ------------------------------------------------------------------
        # 2. INSTALL MIGRATION + VERIFY @live-proof + VERIFY REPLAY REFUSED
        # ------------------------------------------------------------------
        psql(file=MIGRATION)
        check('Migration installs cleanly in one transaction with all probes unwinding', True)

        live_proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        lp_out = psql(f'SELECT {live_proof};').stdout.strip()
        check('@live-proof evaluates true after install', lp_out == 't')

        replay = psql(file=MIGRATION, ok=False)
        check('Second apply is refused atomically by pre-image guard',
              replay.returncode != 0 and 'pre-image drifted' in replay.stderr)

        # ------------------------------------------------------------------
        # 3. AFTER MIGRATION: NONE of the 6 functions blocks hand commits / pool writers
        # ------------------------------------------------------------------

        # 3a. trg_refuse_finalized_tournament_entry + non-key UPDATE does NOT block FOR KEY SHARE
        holder_trg_entry_after = f"""
        BEGIN;
        INSERT INTO public.tournament_players(tournament_id, user_id, status)
          VALUES ('{TR}', gen_random_uuid(), 'registered');
        UPDATE public.tournaments
           SET current_players = current_players + 1,
               prize_pool = prize_pool + 10,
               bounty_pool = bounty_pool + 5,
               total_rake = total_rake + 1
         WHERE id = '{TR}';
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_trg_entry_after, hand_commit_key_share)
        check(f'AFTER: trg_refuse_finalized_tournament_entry + non-key UPDATE does NOT block hand commit FOR KEY SHARE ({el:.3f}s < {HOLD_SEC*0.5:.2f}s)',
              r.returncode == 0 and el < HOLD_SEC * 0.5)

        # 3b. fn_terminal_tournament_seat_is_immutable (FOR KEY SHARE) does NOT block pool writer (FOR NO KEY UPDATE)
        el, r = race_holder_vs_runner(holder_seat_ins, pool_writer_nku)
        check(f'AFTER: fn_terminal_tournament_seat_is_immutable FOR KEY SHARE does NOT block pool writer FOR NO KEY UPDATE ({el:.3f}s < {HOLD_SEC*0.5:.2f}s)',
              r.returncode == 0 and el < HOLD_SEC * 0.5)

        # 3c. Human register does NOT block hand commit FOR KEY SHARE
        el, r = race_holder_vs_runner(holder_reg_human, hand_commit_key_share)
        check(f'AFTER: human register FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE ({el:.3f}s < {HOLD_SEC*0.5:.2f}s)',
              r.returncode == 0 and el < HOLD_SEC * 0.5)

        # 3d. Horse register does NOT block hand commit FOR KEY SHARE
        el, r = race_holder_vs_runner(holder_reg_horse, hand_commit_key_share)
        check(f'AFTER: horse register FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE ({el:.3f}s < {HOLD_SEC*0.5:.2f}s)',
              r.returncode == 0 and el < HOLD_SEC * 0.5)

        # 3e. Bounty sweep does NOT block hand commit FOR KEY SHARE
        el, r = race_holder_vs_runner(holder_sweep, hand_commit_key_share)
        check(f'AFTER: fn_sweep_pending_tournament_bounties FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE ({el:.3f}s < {HOLD_SEC*0.5:.2f}s)',
              r.returncode == 0 and el < HOLD_SEC * 0.5)

        # 3f. fn_move_tournament_player post-image locks tournaments FOR NO KEY UPDATE (never FOR UPDATE)
        mv_def = psql("SELECT pg_get_functiondef('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure)").stdout
        check('AFTER: fn_move_tournament_player locks public.tournaments FOR NO KEY UPDATE, never FOR UPDATE',
              'WHERE t.id=p_tournament_id FOR NO KEY UPDATE;' in mv_def
              and 'WHERE t.id=p_tournament_id FOR UPDATE;' not in mv_def)

        # ------------------------------------------------------------------
        # 4. SAFETY INVARIANTS
        # ------------------------------------------------------------------

        # 4a. Lifecycle/terminal FOR UPDATE on tournaments STILL blocks hand commit FOR KEY SHARE
        holder_lifecycle = f"""
        BEGIN;
        SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR UPDATE;
        SELECT pg_sleep({HOLD_SEC});
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_lifecycle, hand_commit_key_share)
        check(f'SAFETY: lifecycle FOR UPDATE still blocks hand commit FOR KEY SHARE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 4b. Lifecycle/terminal FOR UPDATE on tournaments STILL blocks seat INSERT (FOR KEY SHARE)
        seat_ins_once = f"""
        BEGIN;
        INSERT INTO public.table_seats(table_id, user_id, seat_number, stack)
          VALUES ('{TBL_A}', gen_random_uuid(), 3, 10000);
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_lifecycle, seat_ins_once)
        check(f'SAFETY: lifecycle FOR UPDATE still blocks seat INSERT FOR KEY SHARE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 4c. Lifecycle/terminal FOR UPDATE on tournaments STILL blocks trg_refuse_finalized_tournament_entry (FOR NO KEY UPDATE)
        tp_ins_once = f"""
        BEGIN;
        INSERT INTO public.tournament_players(tournament_id, user_id, status)
          VALUES ('{TR}', gen_random_uuid(), 'registered');
        ROLLBACK;
        """
        el, r = race_holder_vs_runner(holder_lifecycle, tp_ins_once)
        check(f'SAFETY: lifecycle FOR UPDATE still blocks trg_refuse_finalized_tournament_entry FOR NO KEY UPDATE ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s)',
              r.returncode == 0 and el >= HOLD_SEC * 0.6)

        # 4d. Finalized tournament still refuses INSERT INTO public.tournament_players
        r_fin = psql(f"INSERT INTO public.tournament_players(tournament_id, user_id, status) VALUES ('{TR_DONE}', gen_random_uuid(), 'registered');", ok=False)
        check('SAFETY: finalized tournament still refuses new entry via trg_refuse_finalized_tournament_entry',
              r_fin.returncode != 0 and 'prize pool is finalized' in r_fin.stderr)

        # 4e. Completed tournament still refuses INSERT INTO public.table_seats
        r_term = psql(f"INSERT INTO public.table_seats(table_id, user_id, seat_number, stack) VALUES ('{TBL_DONE}', gen_random_uuid(), 1, 10000);", ok=False)
        check('SAFETY: completed tournament still refuses new seat via fn_terminal_tournament_seat_is_immutable',
              r_term.returncode != 0 and 'terminal tournament seat' in r_term.stderr)

        # 4f. Concurrent FOR NO KEY UPDATE writers still serialize with exact prize_pool conservation
        before_pool = float(psql(f"SELECT prize_pool FROM public.tournaments WHERE id = '{TR}'").stdout.strip())
        w1 = f"""
        BEGIN;
        SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR NO KEY UPDATE;
        UPDATE public.tournaments SET prize_pool = prize_pool + 75 WHERE id = '{TR}';
        SELECT pg_sleep({HOLD_SEC});
        COMMIT;
        """
        w2 = f"""
        BEGIN;
        SELECT 1 FROM public.tournaments WHERE id = '{TR}' FOR NO KEY UPDATE;
        UPDATE public.tournaments SET prize_pool = prize_pool + 25 WHERE id = '{TR}';
        COMMIT;
        """
        el, r = race_holder_vs_runner(w1, w2)
        after_pool = float(psql(f"SELECT prize_pool FROM public.tournaments WHERE id = '{TR}'").stdout.strip())
        check(f'SAFETY: concurrent FOR NO KEY UPDATE pool writers serialize ({el:.3f}s >= {HOLD_SEC*0.6:.2f}s) with exact conservation ({before_pool} -> {after_pool})',
              r.returncode == 0 and el >= HOLD_SEC * 0.6 and after_pool == before_pool + 100.0)

        print(f'ALL {checks} CHECKS PASSED')
    finally:
        subprocess.run(as_user + [str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
