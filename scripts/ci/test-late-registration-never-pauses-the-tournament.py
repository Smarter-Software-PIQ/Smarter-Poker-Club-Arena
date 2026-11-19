"""Native PostgreSQL 16 proof: a late registration never pauses the tournament.

Migration 20261119052513 (incident 075013fd, lane L) moves late registration
and late seating into a RUNNING mtt event off the event's exclusive rolling
lane and the seat gate's field-wide row locks, onto the event's shared change
lane that rebuys and busts already use (20261118191946, 20261119011750). This
builds a throwaway cluster on a Unix socket, installs the EXACT production
pre-images lanes T, R and R2 qualified (their fixtures, then their migrations,
natively) and the registration chain production runs for a horse (the
attendance-target door, the horse door, its terminal and lifecycle gates, the
horse core, the late seat chain, the capacity opener, the satellite
provenance guard, and the person and ticket doors), all md5-checked against
scripts/ci/fixtures/late-registration-never-pauses/preimages.json, and drives
real concurrent sessions:

  BEFORE  production bodies: a late registration in flight blocks other
          tables' per-hand calls of the event; a registration wave stretches
          hand commits.
  AFTER   the unmodified migration file:
          - the same per-hand calls proceed at once (the hand commit waits only
            for the tournament row the registrant's own core holds, never for
            a lane), and the wave no longer stretches them;
          - registration racing a hand settlement, a rebuy and a balancing
            move on its destination table serialises, in both orders;
          - a full field opens a new table inside the shared lane, seats the
            entrant there, and the next entrant uses it;
          - chips and entries are conserved: wallets, prize pool, roster,
            ledger, cached field count;
          - a seat acquisition without authority is still refused; a
            pre-start registration and a caller already holding exclusive
            authority take the seat gate unchanged;
          - a mixed run (registrations, rebuys, hands, moves) logs 0
            deadlocks.

No network and no production connection. Functions the chain reaches that do
not take part in its locking (diamond and ticket lookups, purchase window,
paying club, wallet debit and journal, promo heads, blinds, wake) are minimal
stubs; everything that takes or proves a lock is production text.

Usage: PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/ci/test-late-registration-never-pauses-the-tournament.py [--output DIR]
       --print-post-images  apply the substitutions only and print each md5
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import random

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261118191946_a_rebuy_never_pauses_the_tournament.sql'
MIG2 = ROOT / 'supabase/migrations/20261119011750_bounty_rebuys_and_eliminations_share_the_event_lane.sql'
MIG_T1 = ROOT / 'supabase/migrations/20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql'
MIG_T2 = ROOT / 'supabase/migrations/20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql'
FIX = ROOT / 'scripts/ci/fixtures/rebuy-never-pauses/preimages.json'
FIX_T = ROOT / 'scripts/ci/fixtures/tournament-lane-isolation/preimages.json'
MIG_L = ROOT / 'supabase/migrations/20261119052513_a_late_registration_never_pauses_the_tournament.sql'
FIX_L = ROOT / 'scripts/ci/fixtures/late-registration-never-pauses/preimages.json'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/late-registration-never-pauses')
parser.add_argument('--print-post-images', action='store_true')
args = parser.parse_args()
for p in (MIG, MIG2, MIG_T1, MIG_T2, FIX, FIX_T, MIG_L, FIX_L):
    if not p.exists():
        sys.exit(f'missing {p.relative_to(ROOT)} (lanes T, R and R2 must be in this tree)')
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)

migration = MIG.read_text()
migration2 = MIG2.read_text()
mig_t2_native = re.sub(r'-- @begin caller substitutions.*?-- @end caller substitutions\n', '',
                       MIG_T2.read_text(), flags=re.S)
fix = json.loads(FIX.read_text())['functions'] + json.loads(FIX_T.read_text())['functions']
fix_l = json.loads(FIX_L.read_text())['functions']
migration_l = MIG_L.read_text()

pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='late-reg-lane-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55874'
LOG = cluster / 'log'
results = {'checks': [], 'production_mutations': False,
           'migration_sha256': hashlib.sha256(migration_l.encode()).hexdigest()}


def psql(sql, db='w', check=True, timeout=120):
    cmd = as_owner + [str(pg / 'psql'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                      '-h', str(sock), '-p', PORT, '-U', 'postgres', '-d', db]
    p = subprocess.run(cmd, input=sql, capture_output=True, text=True, env=env, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f'psql failed: {p.stderr}\n--- sql ---\n{sql[:3000]}')
    return p


def q(sql, db='w'):
    return psql(sql, db).stdout.strip()


def bg(sql, db='w'):
    cmd = as_owner + [str(pg / 'psql'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                      '-h', str(sock), '-p', PORT, '-U', 'postgres', '-d', db]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, env=env)
    p.stdin.write(sql)
    p.stdin.close()
    p.t0 = time.monotonic()
    return p


def finish(p, timeout=60):
    p.wait(timeout)
    return time.monotonic() - p.t0, p.returncode, (p.stdout.read() + p.stderr.read()).strip()


def timed(sql, db='w'):
    t0 = time.monotonic()
    p = psql(sql, db, check=False)
    return time.monotonic() - t0, p.returncode, (p.stdout + p.stderr).strip()


def check(name, ok, detail=''):
    results['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)})
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)
    if not ok:
        raise SystemExit(f'check failed: {name}: {detail}')


def wait_until_holding(app, proc=None, db='w', timeout=10.0):
    """Block until the session tagged application_name=app is in its sleep."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if proc is not None and proc.poll() is not None:
            raise RuntimeError(f'{app} ended before its hold: {proc.stdout.read()} {proc.stderr.read()}')
        if q(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' "
             f"AND query LIKE '%pg_sleep%' AND state='active'", db) == '1':
            return
        time.sleep(0.03)
    raise RuntimeError(f'{app} never reached its hold')


def wait_until_waiting(n, db='w', timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if int(q("SELECT count(*) FROM pg_locks WHERE NOT granted", db)) >= n:
            return
        time.sleep(0.03)
    raise RuntimeError(f'expected {n} waiting lock requests')


def uid(prefix, n):
    return f'{prefix}-0000-0000-0000-{n:012d}'


TR = 'aaaaaaaa-0000-0000-0000-00000000000a'   # the event (non-bounty, rebuys and re-entries)
CLUB = '11111111-0000-0000-0000-000000000001'
NT = 9
TBL = [uid('a0a0a0a0', i) for i in range(NT)]
G = "hashtextextended('ca:tournament-terminal-settlement:v1',0)"
TKEY = f"hashtextextended('ca:tournament-terminal-settlement:v1:{TR}',0)"

SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY, union_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, club_id uuid, union_id uuid, name text, variant text,
  tournament_type text, satellite_target_id uuid, satellite_target uuid, status text DEFAULT 'RUNNING',
  prize_pool_finalized boolean DEFAULT false, current_level int DEFAULT 3, late_reg_levels int,
  rebuy_levels int, late_reg_mins int, started_at timestamptz DEFAULT now(), addon_from_start boolean,
  addon_period_started_at timestamptz, addon_period_ends_at timestamptz,
  add_on_available boolean DEFAULT false, addon_period_triggered boolean DEFAULT false,
  is_bounty boolean DEFAULT false, is_pko boolean DEFAULT false, is_mystery_bounty boolean DEFAULT false,
  buy_in_amount numeric DEFAULT 10, buy_in_fee numeric DEFAULT 0, starting_chips int DEFAULT 1000,
  is_rebuy boolean DEFAULT true, is_reentry boolean DEFAULT true, rebuy_cost numeric DEFAULT 10,
  rebuy_chips int DEFAULT 1000, addon_cost numeric, addon_chips int, addon_levels int, max_rebuys int,
  max_reentries int, prize_pool numeric DEFAULT 0, bounty_amount numeric DEFAULT 0,
  bounty_pool numeric DEFAULT 0, total_rake numeric DEFAULT 0, max_players int DEFAULT 0);
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, club_id uuid, status text DEFAULT 'running',
  lifecycle text DEFAULT 'open', is_deleted boolean DEFAULT false, f06_lifecycle bigint,
  current_players int DEFAULT 0, updated_at timestamptz DEFAULT now(), max_players int DEFAULT 9,
  created_at timestamptz DEFAULT now());
CREATE SEQUENCE smarter_private.f06_lifecycle_seq;
CREATE TABLE public.table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  player_id uuid, member_id uuid, seat_number int, stack numeric, status text, joined_at timestamptz,
  left_at timestamptz, is_sitting_out boolean DEFAULT false, is_away boolean DEFAULT false,
  leave_pending boolean DEFAULT false, sit_out_at timestamptz, scheduled_leave_hands int, horse_id uuid,
  club_id uuid, entry_hold text, entry_post_agreed boolean DEFAULT false, auto_rebuy boolean DEFAULT false,
  time_bank_remaining int DEFAULT 30, time_bank_uses_remaining int DEFAULT 4);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
  user_id uuid, club_id uuid, status text, chips int, prize numeric DEFAULT 0, rebuys int DEFAULT 0,
  add_on boolean DEFAULT false, table_id uuid, seat_number int, rebuy_prompt_until timestamptz,
  current_bounty numeric DEFAULT 0, eliminated_at timestamptz, position int, UNIQUE (tournament_id, user_id));
CREATE TABLE public.tournament_knockout_candidates(id uuid PRIMARY KEY, tournament_id uuid,
  eliminated_user_id uuid, hand_number int, hand_id uuid, state text, rebuy_prompt_until timestamptz,
  table_id uuid, seat_id uuid, seat_joined_at timestamptz, resolved_at timestamptz, stack_after numeric,
  stack_before numeric DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE public.entry_purchase_idempotency_receipts(key_domain text, idempotency_key text, request jsonb,
  response jsonb, PRIMARY KEY (key_domain, idempotency_key));
CREATE TABLE public.wallet_credit_idempotency(key text PRIMARY KEY, user_id uuid, amount numeric);
CREATE TABLE public.ca_operator_floor_hold(operation_id uuid, mode text);
CREATE TABLE public.ca_launch_operator_scopes(operation_id uuid, club_ids uuid[]);
CREATE TABLE public.tournament_obligations(tournament_id uuid, user_id uuid, kind text, amount_paid numeric,
  amount_owed numeric, settled_at timestamptz);
CREATE TABLE public.tournament_bounty_obligations(id uuid PRIMARY KEY, tournament_id uuid, eliminated_user_id uuid,
  hand_number int, hand_id uuid, state text, table_id uuid, seat_joined_at timestamptz, mode text,
  claimants jsonb, head_amount numeric, knocker_user_id uuid);
CREATE TABLE public.bounty_paid(obligation_id uuid, user_id uuid, amount numeric);
CREATE TABLE public.hand_atomic_commits(table_id uuid, hand_number bigint, hand_id uuid, stack_result jsonb,
  committed_at timestamptz);
CREATE TABLE public.settlement_idempotency_keys(table_id uuid, hand_id uuid, status text, completed_at timestamptz,
  result jsonb);
CREATE TABLE public.poker_diamond_tournament_ledger(user_id uuid, tournament_id uuid, kind text, amount numeric,
  created_at timestamptz);
CREATE TABLE public.chip_ledger(from_entity_id uuid, tournament_id uuid, category text, from_type text, to_type text,
  status text, amount numeric, created_at timestamptz);
CREATE TABLE public.hand_history(tournament_id uuid, hand_number bigint, players jsonb);
CREATE TABLE public.financial_alerts(severity text, source text, message text, context jsonb, resolved boolean DEFAULT false);
CREATE TABLE smarter_private.f06_elimination_dispatch(xid bigint, relation_name text, row_id uuid, candidate_id uuid,
  old_record jsonb, new_record jsonb);
CREATE TABLE public.tournament_bounty_awards(id uuid, tournament_id uuid, eliminated_user_id uuid,
  bounty_obligation_id uuid, status text, chest_id uuid, revealed_at timestamptz);
CREATE TABLE public.tournament_bounty_chests(id uuid, status text);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_horse boolean DEFAULT false);
CREATE TABLE public.club_members(user_id uuid, club_id uuid, chip_balance numeric, updated_at timestamptz,
  PRIMARY KEY (user_id, club_id));
CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  wallet_type text, type text, amount numeric, category text, description text, related_entity_id uuid,
  balance_after numeric);
CREATE TABLE public.tournament_launch_receipts(tournament_id uuid PRIMARY KEY, completed_at timestamptz,
  launch_id uuid, lease_generation uuid);
CREATE TABLE public.tournament_paid_stack_custody_receipts(transaction_id xid8, state text, tournament_id uuid,
  user_id uuid, destination_table_id uuid, destination_seat_number int, grant_chips numeric,
  live_chips_before numeric, funded_supply numeric, candidate_id uuid);
CREATE TABLE public.ca_promo_play_through_settings(id boolean, enforced_from timestamptz);
CREATE TABLE public.tournament_stage_resume_receipts(tournament_id uuid, resume_id uuid, completed_at timestamptz);
CREATE TABLE public.tournament_seat_exit_authorizations(tournament_id uuid, operation text, token uuid, seat_id uuid, user_id uuid);
CREATE TABLE public.table_hole_cards(table_id uuid, hand_number int, cards text);
CREATE TABLE smarter_private.f06_operations(source_table_id uuid, state text, tournament_id uuid, manifest jsonb,
  close_receipt jsonb, cleanup_kind text, abort_receipt_id uuid, break_id uuid, lifecycle bigint);
CREATE TABLE smarter_private.f06_movement_admissions(break_id uuid);
CREATE TABLE smarter_private.f06_members(break_id uuid);
CREATE TABLE smarter_private.f06_attempts(break_id uuid, request_id uuid, user_id uuid,
  destination_table_id uuid, destination_seat_number int);
CREATE TABLE smarter_private.f06_hand_permits(table_id uuid, hand_number int, tournament_id uuid, state text);
CREATE TABLE smarter_private.f06_unsettled_hand_aborts(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_generation_abort_hands(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_mixed_abort_hands(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_prepared_hand_cancellations(table_id uuid, hand_number int);
CREATE TABLE smarter_private.f06_no_start_continuations(table_id uuid, hand_number int);
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid, boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- Stubs: reached by the rebuy, take no lock that matters to it.
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_claim_entry_purchase_receipt(p_domain text, p_key text, p_request jsonb)
 RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  INSERT INTO public.entry_purchase_idempotency_receipts(key_domain, idempotency_key, request)
  VALUES (p_domain, p_key, p_request) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('claimed', true); END IF;
  SELECT * INTO r FROM public.entry_purchase_idempotency_receipts WHERE key_domain=p_domain AND idempotency_key=p_key;
  RETURN jsonb_build_object('claimed', false, 'response', r.response);
END $$;
CREATE FUNCTION public.fn_record_entry_purchase_receipt(p_domain text, p_key text, p_request jsonb, p_response jsonb)
 RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.entry_purchase_idempotency_receipts SET response=p_response
   WHERE key_domain=p_domain AND idempotency_key=p_key;
  RETURN p_response;
END $$;
CREATE FUNCTION public.fn_ca_latest_committed_knockout_candidate(p_t uuid, p_u uuid) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT c.id FROM public.tournament_knockout_candidates c WHERE c.tournament_id=p_t AND c.eliminated_user_id=p_u
     ORDER BY c.hand_number DESC, c.id DESC LIMIT 1 $$;
CREATE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$ SELECT 'unlimited-mtt-v2'::text $$;
CREATE FUNCTION public.fn_ca_tournament_rebuy_window(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{"open":true}}'::jsonb $$;
CREATE FUNCTION public.fn_ca_tournament_unit_cents(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.fn_ca_promo_retire_busted_entry(uuid,uuid,uuid,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_seat_club_for_user(uuid,uuid,uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT $3 $$;
CREATE FUNCTION public.fn_emit_tournament_manager_wake(uuid,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION public.fn_ensure_late_registration_capacity(uuid,integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{"ok":true}}'::jsonb $$;
CREATE FUNCTION public.fn_ca_tournament_seat_cap(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 9 $$;
CREATE FUNCTION public.fn_ca_tournament_purchase_fee_ratio(numeric,numeric,integer) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_ca_midway_free_buy_format(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.fn_ca_recovery_fee_cents(bigint,numeric,integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION public.fn_ca_unit_floor_cents(bigint,integer) RETURNS bigint LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION public.fn_ensure_club_wallet(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_ca_assert_tournament_chip_grant(uuid,uuid,uuid,numeric,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_ca_record_tournament_participant_funding(uuid,text,text,numeric,text,uuid,uuid,jsonb)
 RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_daily_window_entry_refusal(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.fn_ca_new_tournament_starts_blocked() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_lock_daily_mission_user(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_sync_seat_first_player_count(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_exact_tournament_knockout_claimants(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
-- The bounty collection's lock shape (rolling lane, tournament, obligation,
-- eliminated roster row, then the knocker's roster row and wallet), paying the
-- head from the bounty pool to the knocker; stubbed, its money moves are the
-- ones fn_collect_bounty makes for a regular bounty.
CREATE FUNCTION public.fn_collect_bounty_obligation(p_obligation_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o public.tournament_bounty_obligations%ROWTYPE; k uuid;
BEGIN
  SELECT * INTO o FROM public.tournament_bounty_obligations WHERE id=p_obligation_id;
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(o.tournament_id);
  PERFORM 1 FROM public.tournaments WHERE id=o.tournament_id FOR UPDATE;
  SELECT * INTO o FROM public.tournament_bounty_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF o.state<>'pending' THEN RETURN jsonb_build_object('ok',false,'reason','already_collected'); END IF;
  PERFORM 1 FROM public.tournament_players WHERE tournament_id=o.tournament_id AND user_id=o.eliminated_user_id FOR UPDATE;
  k := (o.claimants->0->>'user_id')::uuid;
  UPDATE public.tournament_players SET current_bounty=current_bounty WHERE tournament_id=o.tournament_id AND user_id=k;
  UPDATE public.club_members SET chip_balance=chip_balance+o.head_amount WHERE user_id=k;
  UPDATE public.tournaments SET bounty_pool=bounty_pool-o.head_amount WHERE id=o.tournament_id;
  INSERT INTO public.bounty_paid VALUES (o.id, k, o.head_amount);
  UPDATE public.tournament_players SET current_bounty=0 WHERE tournament_id=o.tournament_id AND user_id=o.eliminated_user_id;
  UPDATE public.tournament_bounty_obligations SET state='settled' WHERE id=o.id;
  RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamptz,uuid,jsonb,numeric,boolean)
 RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{"ok":false,"reason":"not in this harness"}}'::jsonb $$;
INSERT INTO public.clubs VALUES ('{CLUB}', NULL);
INSERT INTO public.tournaments(id, club_id, name, variant, tournament_type) VALUES ('{TR}','{CLUB}','Morning Free Buy','regular','MTT');
INSERT INTO public.tournament_launch_receipts VALUES ('{TR}', now(), gen_random_uuid(), gen_random_uuid());
"""

TRIGGERS = """
CREATE TRIGGER a00_f06_cancelled_preparation BEFORE INSERT OR UPDATE ON public.table_hole_cards
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_cancelled_preparation_writer_guard();
CREATE TRIGGER a00_f06_aborted_hand BEFORE INSERT OR UPDATE ON public.table_hole_cards
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_aborted_hand_guard();
CREATE TRIGGER a00_f06_source_seat BEFORE INSERT OR UPDATE OR DELETE ON public.table_seats
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_source_guard();
CREATE TRIGGER a00_f06_source_roster BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_players
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_source_guard();
CREATE TRIGGER a0_tournament_live_seat_root_guard BEFORE INSERT OR UPDATE OF table_id, user_id, seat_number, left_at
  ON public.table_seats FOR EACH ROW EXECUTE FUNCTION fn_tournament_live_seat_acquisition_requires_authority();
CREATE TRIGGER a00_f06_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.tables
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_table_guard();
REVOKE ALL ON FUNCTION smarter_private.cancellation_lane(uuid) FROM PUBLIC;
"""

# Seating: on every table 5 players at 1000. Busted players are added per scenario.
PLAYERS = []   # (user, table, seat)
SEED = [f"INSERT INTO public.tables(id, tournament_id, club_id) VALUES " +
        ', '.join(f"('{t}','{TR}','{CLUB}')" for t in TBL) + ';']
n = 0
for ti, t in enumerate(TBL):
    for s in range(1, 6):
        n += 1
        u = uid('b0b0b0b0', n)
        PLAYERS.append((u, t, s))
        SEED.append(f"INSERT INTO public.profiles VALUES ('{u}', false); "
                    f"INSERT INTO public.club_members VALUES ('{u}','{CLUB}',1000,now()); "
                    f"INSERT INTO public.tournament_players(tournament_id,user_id,club_id,status,chips,table_id,seat_number) "
                    f"VALUES ('{TR}','{u}','{CLUB}','playing',1000,'{t}',{s}); ")
SEED_SEATS = ("INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,joined_at,club_id) "
              "SELECT tp.table_id, tp.user_id, tp.seat_number, tp.chips, 'active', now(), tp.club_id "
              f"FROM public.tournament_players tp WHERE tp.tournament_id='{TR}';"
              "UPDATE public.tables tb SET current_players=(SELECT count(*) FROM public.table_seats s "
              "WHERE s.table_id=tb.id AND s.left_at IS NULL);")
BUSTED = []


def bust(kind, table, db='w'):
    """A player who busted at `table` holding a knockout candidate: 'pending'
    (zero-stack live chair, decision window open) or 'eliminated' (chair left).
    Its 1000 chips went to a live player of the same table, so the felt still
    equals the bought-in supply. Returns the player's id."""
    u = uid('c0c0c0c0', len(BUSTED) + 1)
    BUSTED.append(u)
    seat = q(f"SELECT min(n) FROM generate_series(1,9) n WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s "
             f"WHERE s.table_id='{table}' AND s.seat_number=n AND s.left_at IS NULL)", db)
    if not seat and kind == 'eliminated':  # a left chair needs no free number
        seat = '9'
    if not seat:  # a full table: bust at the emptiest one instead
        table = q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' ORDER BY (SELECT count(*) "
                  f"FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL), tb.id LIMIT 1", db)
        return bust_at(u, kind, table, db)
    return bust_at(u, kind, table, db, seat)


def bust_at(u, kind, table, db='w', seat=None):
    if seat is None:
        seat = q(f"SELECT min(n) FROM generate_series(1,9) n WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s "
                 f"WHERE s.table_id='{table}' AND s.seat_number=n AND s.left_at IS NULL)", db)
    live = kind == 'pending'
    psql(f"""
INSERT INTO public.profiles VALUES ('{u}', false);
INSERT INTO public.club_members VALUES ('{u}','{CLUB}',1000,now());
INSERT INTO public.tournament_players(tournament_id,user_id,club_id,status,chips,table_id,seat_number,rebuy_prompt_until)
  VALUES ('{TR}','{u}','{CLUB}','{'playing' if live else 'eliminated'}',0,
          {f"'{table}'" if live else 'NULL'},{seat if live else 'NULL'},{"now()+interval '1 hour'" if live else 'NULL'});
WITH s AS (
  INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,joined_at,left_at,club_id)
  VALUES ('{table}','{u}',{seat},0,'{'active' if live else 'left'}',now()-interval '1 minute',
          {'NULL' if live else 'now()'},'{CLUB}') RETURNING id, joined_at)
INSERT INTO public.tournament_knockout_candidates(id,tournament_id,eliminated_user_id,hand_number,hand_id,state,
  rebuy_prompt_until,table_id,seat_id,seat_joined_at,stack_after)
SELECT gen_random_uuid(),'{TR}','{u}',7,gen_random_uuid(),'{'pending' if live else 'eliminated'}',
  {"now()+interval '1 hour'" if live else 'NULL'},'{table}',s.id,s.joined_at,0 FROM s;
WITH w AS (SELECT s.id FROM public.table_seats s WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.stack>0
           ORDER BY s.id LIMIT 1)
UPDATE public.table_seats s SET stack=s.stack+1000 FROM w WHERE s.id=w.id;
UPDATE public.tournament_players tp SET chips=s.stack FROM public.table_seats s
 WHERE s.user_id=tp.user_id AND s.left_at IS NULL AND tp.tournament_id='{TR}';
UPDATE public.tables tb SET current_players=(SELECT count(*) FROM public.table_seats s
 WHERE s.table_id=tb.id AND s.left_at IS NULL) WHERE tb.id='{table}';
""", db)
    return u


def bust_closed(table, db='w'):
    """A bust whose rebuy window has closed, with the accepted hand's evidence
    the elimination door proves (atomic commit and settlement receipt)."""
    u = bust('pending', table, db)
    psql(f"""
UPDATE public.tournament_players SET rebuy_prompt_until=now()-interval '1 minute' WHERE user_id='{u}';
UPDATE public.tournament_knockout_candidates SET rebuy_prompt_until=now()-interval '1 minute' WHERE eliminated_user_id='{u}';
INSERT INTO public.hand_atomic_commits(table_id,hand_number,hand_id,stack_result,committed_at)
SELECT c.table_id,c.hand_number,c.hand_id,jsonb_build_object('hand_id',md5(c.hand_id::text)::uuid,
  'table_id',c.table_id,'hand_number',c.hand_number::text,'written',jsonb_build_object('{u}',0)),now()-interval '2 minutes'
  FROM public.tournament_knockout_candidates c WHERE c.eliminated_user_id='{u}';
INSERT INTO public.settlement_idempotency_keys(table_id,hand_id,status,completed_at,result)
SELECT c.table_id,md5(c.hand_id::text)::uuid,'succeeded',now(),jsonb_build_object('table_id',c.table_id,
  'hand_number',c.hand_number::text,'written',jsonb_build_object('{u}',0))
  FROM public.tournament_knockout_candidates c WHERE c.eliminated_user_id='{u}';
""", db)
    return u


def bust_bounty(table, knocker, head=4, db='w'):
    """A player out of a bounty event: an eliminated generation whose head
    (funded from its wallet into the bounty pool) is owed to `knocker` by a
    pending obligation, as the bounty claim leaves it."""
    u = bust('eliminated', table, db)
    psql(f"""
UPDATE public.club_members SET chip_balance=chip_balance-{head} WHERE user_id='{u}';
INSERT INTO public.wallet_transactions(user_id,wallet_type,type,amount,category,related_entity_id)
  VALUES ('{u}','PLAYER','debit',{head},'bounty_head','{TR}');
UPDATE public.tournaments SET bounty_pool=bounty_pool+{head} WHERE id='{TR}';
UPDATE public.tournament_players SET current_bounty={head} WHERE user_id='{u}';
INSERT INTO public.tournament_bounty_obligations(id,tournament_id,eliminated_user_id,hand_number,hand_id,state,
  table_id,seat_joined_at,mode,claimants,head_amount,knocker_user_id)
SELECT gen_random_uuid(),c.tournament_id,c.eliminated_user_id,c.hand_number,c.hand_id,'pending',c.table_id,
  c.seat_joined_at,'regular',jsonb_build_array(jsonb_build_object('user_id','{knocker}')),{head},'{knocker}'
  FROM public.tournament_knockout_candidates c WHERE c.eliminated_user_id='{u}';
""", db)
    return u


POSITION = [900]


def elim_sql(u, hold=0.0, app='elim'):
    POSITION[0] -= 1
    return (f"SET application_name='{app}'; BEGIN; SELECT public.fn_eliminate_tournament_player_atomic('{TR}','{u}',"
            f"{POSITION[0]},0,0)->>'ok'; " + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")


def rebuy_sql(u, kind, hold=0.0, app='rebuy'):
    typ = 'rebuy' if kind == 'pending' else 'reentry'
    return (f"SET application_name='{app}'; BEGIN; SELECT public.process_tournament_rebuy('{TR}','{u}','{typ}',10,1000,NULL,NULL)->>'success'; "
            + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")


# The per-hand writers production runs, each one transaction (lane T's shapes).
def w_wait(table):   # insert_hole_cards / snapshot / post-commit / projection
    return (f"BEGIN; SELECT smarter_private.f06_wait_table_lane('{table}'); "
            f"INSERT INTO public.table_hole_cards VALUES ('{table}',7,'x'); COMMIT;")


def w_share(table):  # f06 begin / finish / continuation / hand number: locks its table and seats
    return f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT public.fn_ca_f06_share_table_lane('{TR}', gen_random_uuid(), '{table}'); COMMIT;"


def w_settle(table, amount=7, hold=0.0, app='hand'):
    """The hand commit: its shared lane, its table row, then a zero-sum stack
    move between two funded chairs of the table and their roster mirrors."""
    return (f"SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='4s'; "
            f"SELECT public.fn_ca_share_settlement_lane_for_table('{table}'); "
            f"SELECT 1 FROM public.tables WHERE id='{table}' FOR UPDATE; "
            f"WITH two AS (SELECT s.id, row_number() OVER (ORDER BY s.id) rn FROM public.table_seats s "
            f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.stack>{amount} ORDER BY s.id LIMIT 2) "
            f"UPDATE public.table_seats s SET stack=s.stack+CASE two.rn WHEN 1 THEN {amount} ELSE -{amount} END "
            f"  FROM two WHERE s.id=two.id AND (SELECT count(*) FROM two)=2; "
            f"UPDATE public.tournament_players tp SET chips=s.stack FROM public.table_seats s "
            f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.user_id=tp.user_id "
            f"  AND tp.tournament_id='{TR}'; "
            + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")


def w_move(user, dest, hold=0.0, app='move'):
    """A balancing move: the event's rolling lane (T exclusive), both table rows
    in id order, the first free chair of the destination read under its row."""
    return f"""SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='8s';
SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TR}');
SELECT 1 FROM public.tables WHERE id IN ('{dest}', (SELECT table_id FROM public.table_seats
  WHERE user_id='{user}' AND left_at IS NULL)) ORDER BY id FOR UPDATE;
DO $m$ DECLARE v_src uuid; v_seat int; BEGIN
  SELECT table_id INTO v_src FROM public.table_seats WHERE user_id='{user}' AND left_at IS NULL;
  IF v_src IS NULL OR v_src='{dest}' THEN RETURN; END IF;
  SELECT min(n) INTO v_seat FROM generate_series(1,9) n WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s
    WHERE s.table_id='{dest}' AND s.seat_number=n AND s.left_at IS NULL);
  IF v_seat IS NULL THEN RETURN; END IF;
  UPDATE public.table_seats SET table_id='{dest}', seat_number=v_seat WHERE user_id='{user}' AND left_at IS NULL;
  UPDATE public.tournament_players SET table_id='{dest}', seat_number=v_seat WHERE tournament_id='{TR}' AND user_id='{user}';
  UPDATE public.tables tb SET current_players=(SELECT count(*) FROM public.table_seats s
    WHERE s.table_id=tb.id AND s.left_at IS NULL) WHERE tb.id IN (v_src,'{dest}');
END $m$;
""" + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;"


def invariants(label, db='w'):
    """Chips conserved and every chair unique, read from the rows."""
    r = json.loads(q(f"""SELECT json_build_object(
 'wallets_plus_pool', (SELECT sum(chip_balance) FROM public.club_members)
     + (SELECT prize_pool + bounty_pool + total_rake FROM public.tournaments WHERE id='{TR}'),
 'members', (SELECT count(*) FROM public.club_members),
 'felt', (SELECT COALESCE(sum(s.stack),0) FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
          WHERE tb.tournament_id='{TR}' AND s.left_at IS NULL),
 'supply', (SELECT count(*)*1000 + COALESCE(sum(rebuys),0)*1000 FROM public.tournament_players WHERE tournament_id='{TR}'),
 'mirror', (SELECT COALESCE(sum(chips),0) FROM public.tournament_players WHERE tournament_id='{TR}' AND status='playing'),
 'ledger', (SELECT COALESCE(sum(amount),0) FROM public.wallet_transactions WHERE related_entity_id='{TR}' AND type='debit'),
 'pool', (SELECT prize_pool + bounty_pool FROM public.tournaments WHERE id='{TR}')
     + (SELECT COALESCE(sum(amount),0) FROM public.bounty_paid),
 'rebuys', (SELECT COALESCE(sum(rebuys),0) FROM public.tournament_players WHERE tournament_id='{TR}'),
 'dup_chairs', (SELECT count(*) FROM (SELECT table_id, seat_number FROM public.table_seats WHERE left_at IS NULL
                GROUP BY 1,2 HAVING count(*)>1) d),
 'multi_seated', (SELECT count(*) FROM (SELECT user_id FROM public.table_seats WHERE left_at IS NULL
                GROUP BY 1 HAVING count(*)>1) d),
 'roster_mismatch', (SELECT count(*) FROM public.tournament_players tp LEFT JOIN public.table_seats s
                ON s.user_id=tp.user_id AND s.left_at IS NULL WHERE tp.status='playing'
                AND (s.id IS NULL OR s.table_id IS DISTINCT FROM tp.table_id OR s.seat_number IS DISTINCT FROM tp.seat_number
                     OR s.stack::int IS DISTINCT FROM tp.chips)),
 'count_mismatch', (SELECT count(*) FROM public.tables tb WHERE tb.current_players <>
                (SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL)))""", db))
    ok = (r['wallets_plus_pool'] == r['members'] * 1000 and r['felt'] == r['supply'] == r['mirror']
          and r['ledger'] == r['pool'] and r['dup_chairs'] == 0
          and r['multi_seated'] == 0 and r['roster_mismatch'] == 0 and r['count_mismatch'] == 0)
    check(f'{label}: chips conserved (wallets+pool, felt=supply=roster, ledger=pool) and every chair unique', ok, r)
    return r


def install(db):
    psql(SCHEMA, db)
    for f in fix:
        assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], f['signature']
        psql(f['definition'], db)
        live = q(f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))", db)
        assert live == f['md5'], (f['signature'], live, f['md5'])
    psql(TRIGGERS, db)
    psql('\n'.join(SEED) + SEED_SEATS, db)


def subs_post_images(db, text):
    """A migration's substitutions applied to the live pre-images (print mode)."""
    blk = re.search(r'DO \$subs\$(.*?)END \$subs\$;', text, re.S).group(1)
    rows = re.findall(r"\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([^']*)',\s*"
                      r"ARRAY\[(.*?)\],\s*ARRAY\[(.*?)\]\)", blk, re.S)
    res = {}
    for sig, pre, _post, olds, news in rows:
        o = re.findall(r'\$(o\d+)\$(.*?)\$\1\$', olds, re.S)
        nw = re.findall(r'\$(n\d+)\$(.*?)\$\1\$', news, re.S)
        d = psql(f"SELECT pg_get_functiondef('{sig}'::regprocedure)", db).stdout[:-1]
        assert hashlib.md5(d.encode()).hexdigest() == pre, (sig, hashlib.md5(d.encode()).hexdigest())
        for (_, a), (_, b) in zip(o, nw):
            assert d.count(a) == 1, (sig, a[:60])
            d = d.replace(a, b)
        res[sig] = hashlib.md5(d.encode()).hexdigest()
    return res



# ── Lane L: the registration chain's schema, stand-ins and fixtures ─────────
TR2 = 'aaaaaaaa-0000-0000-0000-00000000000b'   # a second event, still REGISTERING
HORSES = []

EXTRA = f"""
ALTER TABLE public.tournaments ADD COLUMN current_players int DEFAULT 0,
  ADD COLUMN format_contract text DEFAULT 'mtt-v2', ADD COLUMN early_bird_enabled boolean DEFAULT false,
  ADD COLUMN early_bird_chips int, ADD COLUMN start_time timestamptz DEFAULT now() - interval '1 hour',
  ADD COLUMN free_buy boolean DEFAULT false, ADD COLUMN game_type text DEFAULT 'nlh',
  ADD COLUMN table_size int DEFAULT 9, ADD COLUMN action_time_seconds int DEFAULT 15,
  ADD COLUMN big_blind_ante boolean, ADD COLUMN all_in_or_fold boolean, ADD COLUMN allow_rabbit_hunt boolean;
ALTER TABLE public.tournament_players ADD COLUMN username text, ADD COLUMN mystery_bounty_value numeric,
  ADD COLUMN bounties_collected int, ADD COLUMN bounty_winnings numeric,
  ADD COLUMN is_satellite_qualifier boolean DEFAULT false, ADD COLUMN source_satellite_id uuid;
ALTER TABLE public.tables ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tables ADD COLUMN name text, ADD COLUMN game_type text, ADD COLUMN game_variant text,
  ADD COLUMN stakes text, ADD COLUMN small_blind numeric, ADD COLUMN big_blind numeric, ADD COLUMN ante numeric,
  ADD COLUMN min_buy_in numeric, ADD COLUMN max_buy_in numeric, ADD COLUMN action_time_seconds int,
  ADD COLUMN big_blind_ante_enabled boolean, ADD COLUMN all_in_or_fold boolean, ADD COLUMN allow_rabbit_hunt boolean;
ALTER TABLE public.profiles ADD COLUMN display_name text, ADD COLUMN username text, ADD COLUMN diamonds numeric;
CREATE TABLE public.tournament_refund_entitlements(tournament_id uuid, user_id uuid, registration_id uuid,
  entitlement_kind text, source_ticket_id uuid);
CREATE TABLE public.rake_records(hand_id uuid, table_id uuid, club_id uuid, rake_amount numeric, pot_size numeric,
  num_players int, bbj_contribution numeric, is_tournament boolean, tournament_id uuid, source text, metadata jsonb);
CREATE TABLE public.tournament_capacity_table_receipts(table_id uuid PRIMARY KEY, tournament_id uuid,
  manager_wake_id bigint, manager_admitted_at timestamptz, created_at timestamptz DEFAULT clock_timestamp(),
  updated_at timestamptz);
CREATE TABLE public.tournament_manager_wakes(tournament_id uuid, reason text, consumed_at timestamptz);
CREATE TABLE public.tournament_satellite_awards(tournament_id uuid, registration_id uuid);
-- Stand-ins: reached by the chain, take no lock that matters to it.
CREATE FUNCTION public.fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_diamond_economic_text(text,text) RETURNS text LANGUAGE sql AS $$ SELECT 'own_balance'::text $$;
CREATE FUNCTION public.fn_ca_horse_mtt_entry_purchase_window_open(text,text,timestamptz,timestamptz,numeric,numeric,boolean)
 RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_ca_entry_paying_club(uuid,uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_ca_find_tournament_entry_ticket_for(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{"ok":true}}'::jsonb $$;
CREATE FUNCTION public.fn_ca_find_cashier_entry_ticket_for(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{}}'::jsonb $$;
CREATE FUNCTION public.fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_tournament_entry_cap_reached(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.atomic_deduct_wallet_and_log(p_user uuid, p_amount numeric, p_cat text, p_desc text,
  p_a uuid, p_b uuid, p_t uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.club_members SET chip_balance=chip_balance-p_amount, updated_at=now()
   WHERE user_id=p_user AND chip_balance>=p_amount;
  RETURN FOUND;
END $$;
CREATE FUNCTION public.log_wallet_transaction(p_user uuid, p_wallet text, p_amount numeric, p_type text, p_cat text,
  p_desc text, p_a uuid, p_b uuid, p_t uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.wallet_transactions(user_id,wallet_type,type,amount,category,description,related_entity_id)
  VALUES (p_user,p_wallet,p_type,p_amount,p_cat,p_desc,p_t) $$;
CREATE FUNCTION smarter_private.free_buy_ticket_redeem(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_ca_tournament_recorded_format(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'mtt-v2'::text $$;
CREATE FUNCTION public.fn_tournament_current_blinds(uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT '{{"small_blind":50,"big_blind":100,"ante":0}}'::jsonb $$;
CREATE FUNCTION public.fn_ca_has_committed_tournament_receipt(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_tournament_recorded_seat_first(uuid,boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- The roster count trigger, production text (fn_sync_tournament_current_players).
CREATE FUNCTION public.fn_sync_tournament_current_players() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tid uuid;
  v_count integer;
BEGIN
  v_tid := COALESCE(NEW.tournament_id, OLD.tournament_id);
  IF v_tid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT count(*) INTO v_count
  FROM public.tournament_players
  WHERE tournament_id = v_tid
    AND status IN ('registered', 'playing');
  UPDATE public.tournaments
     SET current_players = v_count
   WHERE id = v_tid
     AND status IN ('ANNOUNCED', 'REGISTERING')
     AND current_players IS DISTINCT FROM v_count;
  IF TG_OP = 'UPDATE'
     AND NEW.tournament_id IS NOT DISTINCT FROM OLD.tournament_id
     AND (COALESCE(OLD.status, '') IN ('registered', 'playing'))
         IS DISTINCT FROM (COALESCE(NEW.status, '') IN ('registered', 'playing')) THEN
    UPDATE public.tournaments t
       SET current_players = v_count
     WHERE t.id = v_tid
       AND t.status = 'RUNNING'
       AND t.current_players IS DISTINCT FROM v_count
       AND NOT public.fn_ca_tournament_recorded_seat_first(t.id, true);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
"""

EXTRA_TRIGGERS = """
CREATE TRIGGER satellite_target_player_provenance_is_immutable BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_players FOR EACH ROW EXECUTE FUNCTION public.fn_satellite_target_player_provenance_is_immutable();
CREATE TRIGGER trg_sync_tournament_current_players AFTER INSERT OR UPDATE OR DELETE
  ON public.tournament_players FOR EACH ROW EXECUTE FUNCTION public.fn_sync_tournament_current_players();
"""


def install_chain(db='w'):
    """Lanes T, R and R2 natively (production state), then the chain's
    production pre-images, md5-checked."""
    psql(MIG_T1.read_text(), db)
    psql(mig_t2_native, db)
    psql(migration, db)
    psql(migration2, db)
    psql(EXTRA, db)
    for f in fix_l:
        assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], f['signature']
        psql(f['definition'], db)
        live = q(f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))", db)
        assert live == f['md5'], (f['signature'], live, f['md5'])
    psql(EXTRA_TRIGGERS, db)
    # Distinct creation times make the late seat's table choice deterministic.
    psql(f"UPDATE public.tables tb SET created_at = now() - make_interval(secs => 100 - n.i) "
         f"FROM (SELECT id, row_number() OVER (ORDER BY id) i FROM public.tables) n WHERE n.id = tb.id;"
         f"INSERT INTO public.tournaments(id, club_id, name, variant, tournament_type, status, start_time, buy_in_amount) "
         f"VALUES ('{TR2}','{CLUB}','Evening Freeroll','regular','MTT','REGISTERING', now() + interval '1 hour', 0);"
         f"INSERT INTO public.tournament_launch_receipts VALUES ('{TR2}', NULL, gen_random_uuid(), gen_random_uuid());", db)
    sync_counts(db)


def sync_counts(db='w'):
    psql("UPDATE public.tournaments t SET current_players=(SELECT count(*) FROM public.tournament_players tp "
         "WHERE tp.tournament_id=t.id AND tp.status IN ('registered','playing'));", db)


def horse(db='w'):
    h = uid('e0e0e0e0', len(HORSES) + 1)
    HORSES.append(h)
    psql(f"INSERT INTO public.profiles(id, is_horse, username) VALUES ('{h}', true, 'Horse {len(HORSES)}'); "
         f"INSERT INTO public.club_members VALUES ('{h}','{CLUB}',1000,now());", db)
    return h


def reg_sql(h, hold=0.0, app='reg', tr=TR):
    """The horse fleet's late entry: the attendance-target door, as the engine calls it."""
    return (f"SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='8s'; "
            f"SELECT public.fn_register_horse_for_tournament_to_target('{tr}','{h}',true,100000)::text; "
            + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")


def reg_ok(out):
    return '"ok": true' in out


def w_commit(table, amount=7, hold=0.0, app='hand'):
    """The hand commit in production's order (fn_ca_settle_hand_stacks_absolute):
    its shared lane, the tournament row FOR SHARE, the hand's roster rows, its
    table row, then a zero-sum stack move and the roster mirrors."""
    return (f"SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='8s'; "
            f"SELECT public.fn_ca_share_settlement_lane_for_table('{table}'); "
            f"SELECT 1 FROM public.tournaments WHERE id='{TR}' FOR SHARE; "
            f"SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id='{TR}' AND tp.status='playing' "
            f"  AND tp.user_id IN (SELECT user_id FROM public.table_seats WHERE table_id='{table}' AND left_at IS NULL) "
            f"  ORDER BY tp.user_id FOR UPDATE; "
            f"SELECT 1 FROM public.tables WHERE id='{table}' FOR UPDATE; "
            f"WITH two AS (SELECT s.id, row_number() OVER (ORDER BY s.id) rn FROM public.table_seats s "
            f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.stack>{amount} ORDER BY s.id LIMIT 2) "
            f"UPDATE public.table_seats s SET stack=s.stack+CASE two.rn WHEN 1 THEN {amount} ELSE -{amount} END "
            f"  FROM two WHERE s.id=two.id AND (SELECT count(*) FROM two)=2; "
            f"UPDATE public.tournament_players tp SET chips=s.stack FROM public.table_seats s "
            f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.user_id=tp.user_id "
            f"  AND tp.tournament_id='{TR}'; "
            + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")


def next_destination():
    """The table fn_seat_late_registrant_before_maintenance_gate picks."""
    return q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' AND tb.status IN ('waiting','running','active') "
             f"AND (SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL) "
             f"< COALESCE(tb.max_players,9) ORDER BY (SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id "
             f"AND s.left_at IS NULL) DESC, tb.created_at ASC LIMIT 1")


def seat_of(u):
    return q(f"SELECT table_id||':'||seat_number FROM public.table_seats WHERE user_id='{u}' AND left_at IS NULL")


def t_mode(app, tr=TR):
    key = f"hashtextextended('ca:tournament-terminal-settlement:v1:{tr}',0)"
    return q(f"SELECT COALESCE(string_agg(l.mode, ',' ORDER BY l.mode),'none') FROM pg_locks l "
             f"JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='{app}' AND l.locktype='advisory' "
             f"AND l.granted AND (l.classid::bigint<<32 | l.objid::bigint) = ({key} & x'ffffffffffffffff'::bigint)")


def field(label):
    """invariants() plus the registration's own books: the cached field count,
    one roster row per entrant, every horse's buy-in in the pool."""
    r = invariants(label)
    c = json.loads(q(f"""SELECT json_build_object(
 'cached', (SELECT current_players FROM public.tournaments WHERE id='{TR}'),
 'live', (SELECT count(*) FROM public.tournament_players WHERE tournament_id='{TR}' AND status IN ('registered','playing')),
 'unseated', (SELECT count(*) FROM public.tournament_players tp WHERE tp.tournament_id='{TR}' AND tp.status IN ('registered','playing')
              AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.user_id=tp.user_id AND s.left_at IS NULL)),
 'horses_in', (SELECT count(*) FROM public.tournament_players WHERE tournament_id='{TR}'
              AND user_id IN (SELECT id FROM public.profiles WHERE is_horse)),
 'horse_debits', (SELECT COALESCE(sum(amount),0) FROM public.wallet_transactions WHERE related_entity_id='{TR}'
              AND category='tournament_buyin'),
 'dup_entries', (SELECT count(*) FROM (SELECT user_id FROM public.tournament_players WHERE tournament_id='{TR}'
              GROUP BY 1 HAVING count(*)>1) d))"""))
    ok = (c['cached'] == c['live'] and c['unseated'] == 0 and c['dup_entries'] == 0
          and c['horse_debits'] == c['horses_in'] * 10)
    check(f'{label}: entries conserved (cached field = roster, every entrant seated once, each buy-in booked)', ok, c)
    return r, c


def hold_probe(label, holder_sql, app, busy, expect_wait):
    hold = bg(holder_sql)
    wait_until_holding(app, hold)
    mode = t_mode(app)
    res = {}
    jobs = {'card_write': w_wait(busy[0]), 'f06_share': w_share(busy[1]), 'hand_commit': w_commit(busy[2])}
    ths = [threading.Thread(target=lambda k, s: res.__setitem__(k, timed(s)), args=kv) for kv in jobs.items()]
    [t.start() for t in ths]
    time.sleep(0.4)
    # What a waiting hand commit is waiting ON (advisory lane, or a row).
    waits = q(f"SELECT COALESCE(string_agg(DISTINCT l.locktype, ','), 'none') FROM pg_locks l JOIN pg_stat_activity a "
              f"ON a.pid=l.pid WHERE NOT l.granted AND a.application_name='hand'")
    [t.join() for t in ths]
    rb = finish(hold)
    return mode, res, rb, waits


def wave(label, n_reg=16, hold_workers=6):
    """A registration wave (horses in parallel, as the fleet sends them) beside
    continuous hand commits and card writes on every table."""
    rng = random.Random(len(label))
    hs = [horse() for _ in range(n_reg)]
    stop = threading.Event()
    lat = []
    lock = threading.Lock()

    def hands():
        while not stop.is_set():
            dt, rc, o = timed(w_commit(TBL[rng.randrange(NT)], amount=rng.randrange(1, 5)))
            with lock:
                lat.append((dt, rc))

    def regs(items):
        for h in items:
            dt, rc, o = timed(reg_sql(h))
            with lock:
                regs_out.append((dt, rc, o))

    regs_out = []
    hw = [threading.Thread(target=hands) for _ in range(hold_workers)]
    [t.start() for t in hw]
    time.sleep(0.5)
    quiet = len(lat)
    rw = [threading.Thread(target=regs, args=(hs[i::4],)) for i in range(4)]
    t0 = time.monotonic()
    [t.start() for t in rw]
    [t.join() for t in rw]
    wave_s = time.monotonic() - t0
    stop.set()
    [t.join() for t in hw]
    during = sorted(x[0] for x in lat[quiet:])
    pct = lambda p: round(during[min(len(during) - 1, int(p * len(during)))], 3) if during else None
    out = {'registrations': len(regs_out), 'registered': sum(1 for x in regs_out if x[1] == 0 and reg_ok(x[2])),
           'wave_seconds': round(wave_s, 3), 'hand_commits_during': len(during),
           'hand_p50_s': pct(0.5), 'hand_p90_s': pct(0.9), 'hand_p99_s': pct(0.99), 'hand_max_s': pct(1.0),
           'hand_failures': sum(1 for x in lat if x[1] != 0),
           'reg_max_s': round(max(x[0] for x in regs_out), 3)}
    return out, regs_out


try:
    subprocess.run(as_owner + [str(pg / 'initdb'), '-D', str(cluster / 'data'), '-U', 'postgres', '-A', 'trust',
                               '--no-locale'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-l', str(LOG), '-o',
                   f"-k {sock} -p {PORT} -c listen_addresses='' -c log_lock_waits=on -c deadlock_timeout=200ms "
                   "-c max_connections=80", '-w', 'start'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'createdb'), '-h', str(sock), '-p', PORT, '-U', 'postgres', 'w'],
                   check=True, env=env)

    install('w')
    install_chain('w')

    if args.print_post_images:
        for sig, h in subs_post_images('w', migration_l).items():
            print(sig, h)
        gate = re.search(r'^(CREATE FUNCTION public\.fn_ca_lock_tournament_registration_acquisition.*?\$function\$;)',
                         migration_l, re.S | re.M).group(1)
        psql(gate)
        print('public.fn_ca_lock_tournament_registration_acquisition(uuid,uuid)',
              q("SELECT md5(pg_get_functiondef('public.fn_ca_lock_tournament_registration_acquisition(uuid,uuid)'::regprocedure))"))
        raise SystemExit(0)

    check(f'pre-images are byte-identical to production ({len(fix) + len(fix_l)} md5s; lanes T, R, R2 installed natively)', True)
    field('seeded field')

    # ── BEFORE: production bodies ─────────────────────────────────────────
    h = horse()
    dest = next_destination()
    others = [t for t in TBL if t != dest]
    mode, res, rb, waits = hold_probe('before', reg_sql(h, hold=2.0), 'reg', others[:3], True)
    check('before: the production late registration completes (fixture is faithful)', rb[1] == 0 and reg_ok(rb[2]),
          rb[2][-300:])
    check('before: the production late registration holds its event lane T(id) EXCLUSIVE',
          'ExclusiveLock' in mode, mode)
    for k, (dt, rc, o) in res.items():
        check(f'before: {k} on another table WAITS for the registration (the defect)', dt >= 1.2,
              f'{dt:.2f}s rc={rc}')
    results['before_hold'] = {k: round(v[0], 3) for k, v in res.items()}
    field('before: one late entrant')
    w_before, _ = wave('before')
    check('before: a 16-horse wave registers', w_before['registered'] == 16, w_before)
    results['before_wave'] = w_before
    print('before wave', w_before, flush=True)
    field('before: after the wave')

    # ── Install this migration ────────────────────────────────────────────
    refusal = psql(migration_l.replace("'b76daaf8587cca4eeac91ec39e9e7ce3'", "'00000000000000000000000000000000'"),
                   check=False)
    check('the migration refuses when lane R2 is not its pinned text', refusal.returncode != 0
          and 'must be installed first' in refusal.stderr, refusal.stderr.strip()[-160:])
    p = psql(migration_l, check=False)
    check('migration 20261119052513 installs (pre-image pins, anchors, post-image pins, doctrine ok)',
          p.returncode == 0, p.stderr.strip()[-600:])
    doctrine = q("SELECT public.fn_ca_settlement_lane_doctrine()")
    check('doctrine holds after the change, rules 6 and 7 included', json.loads(doctrine)['ok'] is True, doctrine)
    again = psql(migration_l, check=False)
    check('the migration refuses to run twice', again.returncode != 0, again.stderr.strip()[-160:])
    live = q("SELECT md5(pg_get_functiondef('public.fn_seat_late_registrant(uuid,uuid)'::regprocedure))")
    check('the live-proof md5 in the header is the installed late seat', f"= '{live}')" in migration_l, live)

    # ── AFTER 1: the per-hand calls proceed at once ───────────────────────
    h = horse()
    dest = next_destination()
    others = [t for t in TBL if t != dest]
    mode, res, rb, waits = hold_probe('after', reg_sql(h, hold=2.0), 'reg', others[:3], False)
    check('after: the late registration completes on the shared lane', rb[1] == 0 and reg_ok(rb[2]), rb[2][-300:])
    check('after: a late registration in flight holds its event lane T(id) SHARED only', mode == 'ShareLock', mode)
    for k in ('card_write', 'f06_share'):
        dt, rc, o = res[k]
        check(f'after: {k} on another table proceeds at once while the registration is in flight',
              rc == 0 and dt < 0.5, f'{dt:.3f}s rc={rc} {o[-120:]}')
    dt, rc, o = res['hand_commit']
    check('after: a hand commit on another table waits only for the tournament row the core holds, never a lane',
          rc == 0 and 'advisory' not in waits, f'{dt:.3f}s waiting on {waits}')
    results['after_hold'] = {k: round(v[0], 3) for k, v in res.items()}
    results['after_hold_hand_commit_waits_on'] = waits
    check('after: the registrant sits at the table the late seat chose', seat_of(h).startswith(dest), seat_of(h))
    field('after: one late entrant')

    # Re-entry: the attendance door, the horse door and the late seat each ask
    # the registration root; the lane is taken once.
    h = horse()
    o = q(f"BEGIN; SELECT public.fn_register_horse_for_tournament_to_target('{TR}','{h}',true,100000)->>'ok'; "
          f"SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND mode='ExclusiveLock' "
          f"AND (classid::bigint<<32 | objid::bigint) = ({TKEY} & x'ffffffffffffffff'::bigint); COMMIT;")
    check('after: the nested doors re-enter the held lane and never take T(id) exclusive', o.split() == ['true', '0'], o)
    field('after: re-entry')

    # ── AFTER 2: registration racing a hand settlement on its destination ──
    for order in ('registration-first', 'hand-first'):
        h = horse()
        dest = next_destination()
        if order == 'registration-first':
            first = bg(reg_sql(h, hold=1.2))
            wait_until_holding('reg', first)
            second = bg(w_commit(dest))
        else:
            first = bg(w_commit(dest, hold=1.2))
            wait_until_holding('hand', first)
            second = bg(reg_sql(h))
        a, b = finish(first), finish(second)
        check(f'after: registration vs hand settlement on its destination table ({order}) serialise',
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and seat_of(h).startswith(dest)
              and reg_ok(a[2] + b[2]), f'second {b[0]:.2f}s seat={seat_of(h)} dest={dest} {a[2][-150:]} {b[2][-150:]}')
        field(f'after: registration vs hand ({order})')

    # ── AFTER 3: registration racing a rebuy (one change of the field at a time)
    for order in ('registration-first', 'rebuy-first'):
        h = horse()
        ub = bust('pending', TBL[7])
        sync_counts()
        if order == 'registration-first':
            first = bg(reg_sql(h, hold=1.2))
            wait_until_holding('reg', first)
            second = bg(rebuy_sql(ub, 'pending'))
        else:
            first = bg(rebuy_sql(ub, 'pending', hold=1.2))
            wait_until_holding('rebuy', first)
            second = bg(reg_sql(h))
        hand = timed(w_share(TBL[8] if TBL[8] != next_destination() else TBL[6]))
        a, b = finish(first), finish(second)
        check(f'after: registration vs rebuy ({order}) serialise on R(id) and both land',
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and seat_of(h) != '', f'second {b[0]:.2f}s {a[2][-150:]} {b[2][-150:]}')
        check(f'after: another table\'s F06 hand call is not held by the queued change ({order})',
              hand[1] == 0 and hand[0] < 0.5, f'{hand[0]:.3f}s')
        field(f'after: registration vs rebuy ({order})')

    # ── AFTER 4: registration racing a balancing move into its destination ─
    for order in ('registration-first', 'move-first'):
        h = horse()
        dest = next_destination()
        src = q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' AND tb.id<>'{dest}' ORDER BY "
                f"(SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL), tb.id LIMIT 1")
        mover = q(f"SELECT user_id FROM public.table_seats WHERE table_id='{src}' AND left_at IS NULL AND stack>0 "
                  f"ORDER BY seat_number LIMIT 1")
        if order == 'registration-first':
            first = bg(reg_sql(h, hold=1.2))
            wait_until_holding('reg', first)
            second = bg(w_move(mover, dest))
        else:
            first = bg(w_move(mover, dest, hold=1.2))
            wait_until_holding('move', first)
            second = bg(reg_sql(h))
        a, b = finish(first), finish(second)
        sr, sm = seat_of(h), seat_of(mover)
        check(f'after: registration vs balancing move ({order}) serialise: both land, the second waited, different chairs',
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and sr != sm and sr != '' and sm != '',
              f'second {b[0]:.2f}s reg={sr} move={sm} {a[2][-150:]} {b[2][-150:]}')
        field(f'after: registration vs move ({order})')

    # ── AFTER 5: a full field opens a new table inside the shared lane ─────
    n_tables = int(q(f"SELECT count(*) FROM public.tables WHERE tournament_id='{TR}'"))
    while next_destination():
        psql(reg_sql(horse()))
    sync_counts()
    field('after: every chair of the field taken')
    h = horse()
    hold = bg(reg_sql(h, hold=1.5))
    wait_until_holding('reg', hold)
    mode = t_mode('reg')
    other = TBL[2]
    card = timed(w_wait(other))
    share = timed(w_share(other))
    rb = finish(hold)
    new_tbl = q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' ORDER BY tb.f06_lifecycle DESC NULLS LAST, "
                f"tb.created_at DESC LIMIT 1")
    receipt = q(f"SELECT count(*) FROM public.tournament_capacity_table_receipts WHERE tournament_id='{TR}'")
    check('after: a full field opens one new table inside the shared lane and seats the entrant there',
          rb[1] == 0 and reg_ok(rb[2]) and mode == 'ShareLock'
          and int(q(f"SELECT count(*) FROM public.tables WHERE tournament_id='{TR}'")) == n_tables + 1
          and receipt == '1' and seat_of(h).startswith(new_tbl), f'mode={mode} receipt={receipt} seat={seat_of(h)} {rb[2][-200:]}')
    check('after: other tables deal while the new table is opened',
          card[1] == 0 and card[0] < 0.5 and share[1] == 0 and share[0] < 0.5, f'card {card[0]:.3f}s share {share[0]:.3f}s')
    h2 = horse()
    psql(reg_sql(h2))
    check('after: the next entrant uses the new table, no second table',
          seat_of(h2).startswith(new_tbl) and int(q(f"SELECT count(*) FROM public.tables WHERE tournament_id='{TR}'")) == n_tables + 1,
          seat_of(h2))
    psql(f"UPDATE public.tables SET created_at=now() WHERE id='{new_tbl}';")
    TBL.append(new_tbl)
    field('after: new table')

    # ── AFTER 6: nothing else acquires a chair without authority ──────────
    stranger = uid('d0d0d0d0', 1)
    psql(f"INSERT INTO public.profiles(id, is_horse) VALUES ('{stranger}', false); "
         f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TR}'); "
         f"INSERT INTO public.tournament_players(tournament_id,user_id,club_id,status,chips) "
         f"VALUES ('{TR}','{stranger}','{CLUB}','registered',0); COMMIT;")
    free_tbl = new_tbl
    seat_sql = (f"INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,joined_at,club_id) "
                f"VALUES ('{free_tbl}','{stranger}',9,0,'active',now(),'{CLUB}');")
    refusals = {
        'T shared only': f"BEGIN; SELECT public.fn_ca_share_settlement_lane_for_table('{free_tbl}'); {seat_sql} COMMIT;",
        'forged marker with T shared, no R': (
            f"BEGIN; SELECT pg_advisory_xact_lock_shared({TKEY}); "
            f"SELECT set_config('ca.tournament_rebuy_lane', '{TR}:{stranger}:'||txid_current(), true); {seat_sql} COMMIT;"),
        "another player's registration lane": (
            f"BEGIN; SELECT public.fn_ca_lock_tournament_registration_acquisition('{TR}','{HORSES[0]}'); {seat_sql} COMMIT;"),
    }
    bystander = bg(w_commit(TBL[3], hold=6.0, app='bystander'))
    wait_until_holding('bystander', bystander)
    for k, sql in refusals.items():
        dt, rc, o = timed(sql)
        ok = rc != 0 and ('TOURNAMENT_SEAT_ACQUISITION_REQUIRES_TERMINAL_AUTHORITY' in o or 'F06_RETRY_CANONICAL_LANE' in o)
        check(f'after: a chair is refused without authority ({k})', ok, o[-160:])
    finish(bystander)
    psql(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TR}'); "
         f"DELETE FROM public.tournament_players WHERE user_id='{stranger}'; COMMIT;")
    sync_counts()

    # A pre-start registration takes the seat gate, unchanged: T(id) exclusive.
    h = horse()
    hold = bg(reg_sql(h, hold=1.0, app='early', tr=TR2))
    wait_until_holding('early', hold)
    mode = t_mode('early', TR2)
    rb = finish(hold)
    check('after: a registration before the start (REGISTERING) takes the seat gate unchanged (T exclusive)',
          rb[1] == 0 and reg_ok(rb[2]) and mode == 'ExclusiveLock', f'{mode} {rb[2][-160:]}')
    # A caller that already holds the event's exclusive authority keeps it.
    h = horse()
    o = q(f"BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TR}'); "
          f"SELECT public.fn_ca_lock_tournament_registration_acquisition('{TR}','{h}')->>'lane'; "
          f"SELECT COALESCE(current_setting('ca.tournament_rebuy_lane', true),'') = ''; COMMIT;")
    check('after: inside an exclusive authority the registration root is the seat gate (no shared lane taken)',
          o.split() == ['t'] or o.split()[-1] == 't', o)
    field('after: refusals')

    # ── AFTER 7: the wave, measured the same way as before ────────────────
    w_after, _ = wave('after')
    check('after: a 16-horse wave registers', w_after['registered'] == 16, w_after)
    results['after_wave'] = w_after
    print('after wave', w_after, flush=True)
    # A 2-core runner makes single-sample tails noisy, so the wave is recorded
    # (results.json) rather than graded; the deterministic proof is the hold
    # probe above. Graded here: no hand commit failed and every entrant landed.
    check('after: every hand commit through the wave committed',
          w_after['hand_failures'] == 0 and w_after['hand_commits_during'] > 0,
          {'before': w_before, 'after': w_after})
    field('after: after the wave')

    # ── AFTER 8: a mixed concurrent run, zero deadlocks ───────────────────
    log_before = LOG.read_text().count('deadlock detected')
    rng = random.Random(75013)
    # Room for the busts: two empty tables join the field, as the balancer
    # would open them.
    extra = [uid('a1a1a1a1', i) for i in range(2)]
    psql("INSERT INTO public.tables(id, tournament_id, club_id) VALUES "
         + ', '.join(f"('{t}','{TR}','{CLUB}')" for t in extra) + ';')
    TBL.extend(extra)
    for i, t in enumerate(extra):
        mover = q(f"SELECT user_id FROM public.table_seats WHERE table_id='{TBL[i]}' AND left_at IS NULL AND stack>0 "
                  f"ORDER BY seat_number LIMIT 1")
        psql(w_move(mover, t))
    for _ in range(10):
        bust('pending', TBL[rng.randrange(NT)])
    pending = BUSTED[-10:]
    sync_counts()
    regs = [reg_sql(horse()) for _ in range(24)]
    outcomes = {'reg': [], 'rebuy': [], 'hand': [], 'move': [], 'wait': []}
    lock = threading.Lock()

    def worker(kind, items):
        for sql in items:
            dt, rc, o = timed(sql)
            with lock:
                outcomes[kind].append((rc, round(dt, 3), o[:300] if (rc or (kind == 'reg' and not reg_ok(o))) else ''))

    hand_jobs = [[w_commit(TBL[rng.randrange(len(TBL))], amount=rng.randrange(1, 5)) for _ in range(40)] for _ in range(6)]
    wait_jobs = [[w_wait(TBL[rng.randrange(len(TBL))]) for _ in range(40)] for _ in range(2)]
    movers = [pu for (pu, t, s) in PLAYERS][::6]
    move_jobs = [[w_move(m, TBL[rng.randrange(NT)]) for m in movers[i::2]] for i in range(2)]
    rebuy_jobs = [[rebuy_sql(u, 'pending') for u in pending[i::2]] for i in range(2)]
    reg_jobs = [regs[i::4] for i in range(4)]
    ths = ([threading.Thread(target=worker, args=('hand', j)) for j in hand_jobs]
           + [threading.Thread(target=worker, args=('wait', j)) for j in wait_jobs]
           + [threading.Thread(target=worker, args=('move', j)) for j in move_jobs]
           + [threading.Thread(target=worker, args=('rebuy', j)) for j in rebuy_jobs]
           + [threading.Thread(target=worker, args=('reg', j)) for j in reg_jobs])
    t0 = time.monotonic()
    [t.start() for t in ths]
    [t.join() for t in ths]
    total = sum(len(v) for v in outcomes.values())
    deadlocks = LOG.read_text().count('deadlock detected') - log_before
    failed = {k: [x for x in v if x[0] != 0 or x[2]] for k, v in outcomes.items()}
    results['mixed'] = {'transactions': total, 'seconds': round(time.monotonic() - t0, 2), 'deadlocks': deadlocks,
                        'failures': {k: len(v) for k, v in failed.items()},
                        'hand_p100_s': max(x[1] for x in outcomes['hand'])}
    check(f'mixed run: {total} transactions (24 late registrations, 10 rebuys, 240 hand commits, 80 card writes, '
          f'{len(movers)} balancing moves), 0 deadlocks', deadlocks == 0, results['mixed'])
    check('mixed run: every registration, rebuy, hand, card write and move committed',
          all(not v for v in failed.values()), {k: v[:2] for k, v in failed.items() if v})
    final = field('after: mixed run')
    results['final'] = final
    results['ok'] = True
finally:
    try:
        subprocess.run(as_owner + [str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'fast', 'stop'],
                       capture_output=True, env=env)
        shutil.copy(LOG, out / 'postgres.log')
    except Exception:
        pass
    (out / 'results.json').write_text(json.dumps(results, indent=2, default=str))
    shutil.rmtree(cluster, ignore_errors=True)
