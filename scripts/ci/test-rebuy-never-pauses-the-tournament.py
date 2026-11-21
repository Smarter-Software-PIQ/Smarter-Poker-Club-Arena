"""Native PostgreSQL 16 proof: a rebuy never pauses the tournament.

Migration 20261118191946 (incident 075013fd, lane R) moves
process_tournament_rebuy off its event's exclusive rolling lane onto a shared
rebuy lane (R(id) exclusive, G and T(id) shared). This builds a throwaway
cluster on a Unix socket, installs the EXACT production pre-images of the
rebuy, its seat gate, chair chooser, seat assignment, money core and the seat
root guard (scripts/ci/fixtures/rebuy-never-pauses/preimages.json) and of the
lane functions lane T qualified (scripts/ci/fixtures/tournament-lane-isolation/
preimages.json), all md5-checked, and drives real concurrent sessions:

  BEFORE  production bodies: a rebuy in flight blocks another table's
          per-hand call of the same event.
  AFTER   lane T's two migrations, then this one:
          - the same per-hand calls proceed at once while a rebuy is in flight;
          - a rebuy racing a balancing move into its destination table
            serialises, in both orders, with no shared chair;
          - a rebuy racing a hand settlement on its destination table
            serialises on the table row, in both orders;
          - a seat acquisition without exclusive authority is still refused,
            including a forged marker, another player's chair and a table row
            some other transaction holds;
          - chips are conserved: wallets + prize pool, felt vs bought-in
            supply, roster mirrors vs felt, ledger rows vs pool;
          - a mixed concurrent run (rebuys, hands, moves) ends with 0 deadlocks
            in the server log.

LANE E2 (20261119053909) extends it: a balancing move, every step of a table
break, the break scan, the entry close and a bounty sweep (each from the exact
production text in scripts/ci/fixtures/event-scoped-field-lane/preimages.json)
hold T(id) exclusive before it and only the shared lane plus the rows of the
tables they touch after it; one event's cancel holds the platform lane before
and only its own finish lane after. The section times untouched tables, a
second event and a cash table while each is in flight, races each against a
hand of the tables it touches in both orders, runs a whole table break, checks
conservation after every step and ends with a mixed run with 0 deadlocks.

No network and no production connection. Functions the rebuy reaches that do
not take part in its locking (session check, receipts, windows, wake, club
stamp, promo and diamond branches it does not take on a chip event) are
minimal stubs; everything that takes or proves a lock is production text.

Usage: PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/ci/test-rebuy-never-pauses-the-tournament.py [--output DIR]
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
MIG3 = ROOT / 'supabase/migrations/20261119013430_a_bounty_rebuy_never_pauses_the_tournament.sql'
FIX_B7 = ROOT / 'scripts/ci/fixtures/rebuy-never-pauses/b7-preimages.json'
MIG_T1 = ROOT / 'supabase/migrations/20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql'
MIG_T2 = ROOT / 'supabase/migrations/20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql'
FIX = ROOT / 'scripts/ci/fixtures/rebuy-never-pauses/preimages.json'
FIX_T = ROOT / 'scripts/ci/fixtures/tournament-lane-isolation/preimages.json'
# Lane E2 (20261119053909): moves, breaks, entry close, bounty sweeps and a
# single-event cancel fence only their own event and tables.
MIG_E2 = ROOT / 'supabase/migrations/20261119053909_a_move_break_or_cancel_fences_only_its_own_event.sql'
FIX_E2 = ROOT / 'scripts/ci/fixtures/event-scoped-field-lane/preimages.json'
# Lane L (20261119052513) changes the doctrine first; E2 rebases on its post-image.
MIG_L = ROOT / 'supabase/migrations/20261119052513_a_late_registration_never_pauses_the_tournament.sql'
FIX_L = ROOT / 'scripts/ci/fixtures/late-registration-never-pauses/preimages.json'
# Lane E3 (20261119054539) & Lane E4 (20261119181500): hand commits take
# FOR KEY SHARE and shared-change-lane writers take FOR NO KEY UPDATE on
# public.tournaments so tables of one event never wait on each other's row.
MIG_E3 = ROOT / 'supabase/migrations/20261119054539_a_rebuy_reads_promo_fee_state_outside_its_event_lane.sql'
MIG_E4 = ROOT / 'supabase/migrations/20261119181500_tournament_tables_never_wait_on_another_tables_event_row.sql'
FIX_HAND = ROOT / 'scripts/ci/fixtures/original-paid-custody/hand-authorities.json'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/rebuy-never-pauses')
parser.add_argument('--print-post-images', action='store_true')
parser.add_argument('--print-e2-post-images', action='store_true')
args = parser.parse_args()
for p in (MIG, MIG2, MIG_T1, MIG_T2, FIX, FIX_T, MIG_E2, FIX_E2, MIG_L, FIX_L, MIG_E3, MIG_E4, FIX_HAND):
    if not p.exists():
        sys.exit(f'missing {p.relative_to(ROOT)} (lane T, PR #11310, must be in this tree)')
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)

migration = MIG.read_text()
migration2 = MIG2.read_text()
migration3 = MIG3.read_text()
fix_b7 = json.loads(FIX_B7.read_text())['functions']
mig_t2_native = re.sub(r'-- @begin caller substitutions.*?-- @end caller substitutions\n', '',
                       MIG_T2.read_text(), flags=re.S)
fix = json.loads(FIX.read_text())['functions'] + json.loads(FIX_T.read_text())['functions']

pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='rebuy-lane-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55873'
LOG = cluster / 'log'
results = {'checks': [], 'production_mutations': False,
           'migration_sha256': hashlib.sha256(migration.encode()).hexdigest()}


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
 'supply', (SELECT count(*)*1000 + COALESCE(sum(rebuys),0)*1000 + COALESCE(sum(CASE WHEN add_on THEN 1 ELSE 0 END),0)*1000 FROM public.tournament_players WHERE tournament_id='{TR}'),
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


# ══ LANE E2 helpers (20261119053909) ══════════════════════════════════════
TR2 = 'aaaaaaaa-0000-0000-0000-00000000000b'   # a second event of the same club
TBL2 = [uid('a2a2a2a2', i) for i in range(3)]
CASH = uid('c4c4c4c4', 1)                        # a cash table of the same club
GEN = 'eeeeeeee-0000-0000-0000-000000000001'     # the engine lease generation
fix_e2 = json.loads(FIX_E2.read_text())['functions']
migration_e2 = MIG_E2.read_text()

E2_SCHEMA = f"""
CREATE OR REPLACE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
ALTER TABLE public.table_seats ADD COLUMN occupancy_id uuid NOT NULL DEFAULT gen_random_uuid();
DROP TABLE smarter_private.f06_operations, smarter_private.f06_members, smarter_private.f06_attempts,
  smarter_private.f06_hand_permits;
CREATE SEQUENCE smarter_private.f06_ordinal_seq;
CREATE TABLE smarter_private.f06_operations(break_id uuid PRIMARY KEY,
  ordinal bigint NOT NULL DEFAULT nextval('smarter_private.f06_ordinal_seq') UNIQUE, tournament_id uuid NOT NULL,
  source_table_id uuid NOT NULL, lifecycle bigint NOT NULL, boundary_id uuid NOT NULL UNIQUE,
  origin_generation uuid NOT NULL, state text NOT NULL DEFAULT 'park_requested', manifest jsonb,
  revision bigint NOT NULL DEFAULT 0, custody_id uuid, custody_generation uuid, cleanup_kind text,
  close_receipt jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), abort_receipt_id uuid);
CREATE TABLE smarter_private.f06_members(break_id uuid, user_id uuid, source_seat_id uuid, source_seat_number int,
  occupancy_id uuid, PRIMARY KEY (break_id, user_id));
CREATE TABLE smarter_private.f06_attempts(request_id uuid PRIMARY KEY, break_id uuid NOT NULL, user_id uuid NOT NULL,
  revision int NOT NULL, predecessor uuid, amendment_id uuid, amendment_payload jsonb,
  destination_table_id uuid NOT NULL, destination_seat_number int NOT NULL, generation uuid NOT NULL,
  state text NOT NULL DEFAULT 'active', receipt jsonb);
CREATE TABLE smarter_private.f06_hand_permits(permit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
  table_id uuid, lifecycle bigint, hand_number bigint, custody_id uuid, generation uuid, state text DEFAULT 'reserved',
  evidence_id uuid);
CREATE TABLE smarter_private.f06_dispatch(request_id uuid PRIMARY KEY, xid bigint, occupancy_id uuid,
  source_seat_id uuid, lifecycle bigint);
CREATE TABLE smarter_private.f06_hand_dispatch(permit_id uuid PRIMARY KEY, xid bigint);
CREATE TABLE smarter_private.f06_cursors(tournament_id uuid PRIMARY KEY, ordinal bigint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 0);
CREATE TABLE public.tournament_seat_move_receipts(request_id uuid PRIMARY KEY, tournament_id uuid NOT NULL,
  user_id uuid NOT NULL, source_table_id uuid NOT NULL, destination_table_id uuid NOT NULL, source_seat_id uuid NOT NULL,
  destination_seat_id uuid NOT NULL, source_seat_number int NOT NULL, destination_seat_number int NOT NULL,
  source_mode text NOT NULL, stack numeric NOT NULL, moved_at timestamptz NOT NULL);
CREATE TABLE public.engine_tournament_leases(tournament_id uuid PRIMARY KEY, protocol_version int,
  lease_generation uuid, heartbeat_at timestamptz, instance_id text);
ALTER TABLE public.tournament_bounty_obligations ADD COLUMN next_attempt_at timestamptz DEFAULT now(),
  ADD COLUMN attempt_count int DEFAULT 0, ADD COLUMN last_error text, ADD COLUMN settled_at timestamptz,
  ADD COLUMN created_at timestamptz DEFAULT now();
CREATE TABLE public.e2_closed_windows(tournament_id uuid PRIMARY KEY);
-- The relations the F06 source guard's custody branches read once a table
-- is a break source (empty: no retained original hand is being restored).
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_engine_lease_stale_seconds() RETURNS integer LANGUAGE sql AS $$ SELECT 30 $$;
CREATE TABLE smarter_private.retirement_original_hand_restorations(submission_id uuid, transaction_id bigint,
  request_hash text, qualification_hash text, original_generation uuid, successor_generation uuid, instance_id text,
  restored_players int);
CREATE TABLE smarter_private.retirement_original_hand_qualification(submission_id uuid, tournament_id uuid,
  table_id uuid, hand_number bigint, expected jsonb, request_hash text);
CREATE TABLE smarter_private.hand_submissions(submission_id uuid, request_hash text, lease_generation uuid, request jsonb);
CREATE TABLE smarter_private.tournament_abort_operations(operation_id uuid PRIMARY KEY, tournament_ids uuid[],
  reason text, cohort_hash text);
-- Stubs the new paths reach that take no lock: the rebuy window answers per
-- event, the finalizer marks the pool final, a payout marker is a paid row.
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_rebuy_window(p uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT jsonb_build_object('open', NOT EXISTS (SELECT 1 FROM public.e2_closed_windows w WHERE w.tournament_id=p)) $$;
CREATE OR REPLACE FUNCTION public.fn_bounty_obligation_has_complete_marker(p uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.bounty_paid b WHERE b.obligation_id=p) $$;
CREATE FUNCTION public.fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_finalize_tournament_entry_pool_locked(p uuid, s text, m text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.tournaments SET prize_pool_finalized=true WHERE id=p;
  RETURN jsonb_build_object('ok',true,'entry_closed',true,'finalized',true);
END $$;
-- The single-event cancellation's shape (atomic_cancel_tournament et al.): its
-- lane, then the tournament row, then every chair of the event released.
CREATE FUNCTION public.e2_cancel_event(p uuid, hold float8 DEFAULT 0) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM smarter_private.cancellation_lane(p);
  PERFORM 1 FROM public.tournaments WHERE id=p FOR UPDATE;
  PERFORM 1 FROM public.tables WHERE tournament_id=p ORDER BY id FOR UPDATE;
  UPDATE public.table_seats s SET stack=0, left_at=now(), status='left'
    FROM public.tables tb WHERE tb.id=s.table_id AND tb.tournament_id=p AND s.left_at IS NULL;
  UPDATE public.tournament_players SET status='cancelled', chips=0, table_id=NULL, seat_number=NULL WHERE tournament_id=p;
  UPDATE public.tables SET status='closed', current_players=0 WHERE tournament_id=p;
  UPDATE public.tournaments SET status='CANCELLED' WHERE id=p;
  PERFORM pg_sleep(hold);
  RETURN true;
END $$;
INSERT INTO public.tournaments(id, club_id, name, variant, tournament_type, is_rebuy, is_reentry)
  VALUES ('{TR2}','{CLUB}','Afternoon Free Buy','regular','MTT', false, false);
INSERT INTO public.e2_closed_windows VALUES ('{TR2}');
INSERT INTO public.engine_tournament_leases VALUES ('{TR}',2,'{GEN}',now()+interval '1 day','e2'), ('{TR2}',2,'{GEN}',now()+interval '1 day','e2');
"""

E2_TRIGGERS = """
CREATE TRIGGER f06_bind_move_receipt BEFORE INSERT ON public.tournament_seat_move_receipts
  FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_receipt_guard();
-- Production's launch-proof lock on every live chair: launch receipt, then
-- the event row FOR UPDATE (a move's destination chair takes it).
CREATE TRIGGER aa_tournament_live_seat_proof_lock BEFORE INSERT OR DELETE OR UPDATE ON public.table_seats
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_and_validate_tournament_live_seat();
"""


def e2_seed(db='w'):
    sql = [f"INSERT INTO public.tables(id, tournament_id, club_id) VALUES "
           + ', '.join(f"('{t}','{TR2}','{CLUB}')" for t in TBL2) + f", ('{CASH}', NULL, '{CLUB}');"]
    n2 = 0
    for t in TBL2:
        for s2 in range(1, 5):
            n2 += 1
            u = uid('b2b2b2b2', n2)
            sql.append(f"INSERT INTO public.tournament_players(tournament_id,user_id,club_id,status,chips,table_id,seat_number) "
                       f"VALUES ('{TR2}','{u}','{CLUB}','playing',1000,'{t}',{s2});")
    sql.append("INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,joined_at,club_id) "
               "SELECT tp.table_id, tp.user_id, tp.seat_number, tp.chips, 'active', now(), tp.club_id "
               f"FROM public.tournament_players tp WHERE tp.tournament_id='{TR2}';")
    sql.append(f"INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,joined_at,club_id) VALUES "
               f"('{CASH}','{uid('c5c5c5c5', 1)}',1,500,'active',now(),'{CLUB}'),"
               f"('{CASH}','{uid('c5c5c5c5', 2)}',2,500,'active',now(),'{CLUB}');")
    sql.append("UPDATE public.tables tb SET current_players=(SELECT count(*) FROM public.table_seats s "
               "WHERE s.table_id=tb.id AND s.left_at IS NULL);")
    psql('\n'.join(sql), db)


def apply_lane_l(db='w'):
    """Lane L's migration as installed on production before E2: the
    pre-images of the bodies it substitutes (its fixture, md5-checked), then the
    unmodified file without its install-time probe blocks, which execute the
    registration chain this harness does not build (lane L's own native proof,
    scripts/ci/test-late-registration-never-pauses-the-tournament.py, runs them)."""
    text = MIG_L.read_text()
    subs = set(re.findall(r"\('((?:public|smarter_private)\.[^']+)',\s*'[0-9a-f]{32}',\s*'[0-9a-f]{32}',", text))
    for f in json.loads(FIX_L.read_text())['functions']:
        if f['signature'] in subs and 'doctrine' not in f['signature']:
            assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], f['signature']
            psql(f['definition'], db)
    native = re.sub(r'-- @probe-for: [^\n]+\nDO \$probe\$.*?END \$probe\$;\n', '', text, flags=re.S)
    assert '@probe-for' not in native and native.count('BEGIN;') == text.count('BEGIN;')
    psql(native, db)


def e2_install(db='w'):
    psql(E2_SCHEMA, db)
    for f in fix_e2:
        assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], f['signature']
        psql(f['definition'], db)
        live = q(f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))", db)
        assert live == f['md5'], (f['signature'], live, f['md5'])
    psql(E2_TRIGGERS, db)
    e2_seed(db)


def e2_post_images(db, text):
    """The E2 substitutions applied to the live pre-images, and the new
    functions created in a rolled-back transaction: every reviewed md5."""
    blk = re.search(r'DO \$subs\$(.*?)END \$subs\$;', text, re.S).group(1)
    heads = list(re.finditer(r"\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([^']*)',\s*ARRAY\[", blk))
    res = {}
    for hi, m in enumerate(heads):
        sig, pre, post = m.groups()
        seg = blk[m.end(): heads[hi + 1].start() if hi + 1 < len(heads) else len(blk)]
        o = re.findall(r'\$(o\d+)\$(.*?)\$\1\$', seg, re.S)
        nw = re.findall(r'\$(n\d+)\$(.*?)\$\1\$', seg, re.S)
        assert o and len(o) == len(nw), sig
        d = psql(f"SELECT pg_get_functiondef('{sig}'::regprocedure)", db).stdout[:-1]
        assert hashlib.md5(d.encode()).hexdigest() == pre, (sig, hashlib.md5(d.encode()).hexdigest())
        for (_, a), (_, b) in zip(o, nw):
            for k, v in res.items():
                b = b.replace(k, v)
            assert d.count(a) == 1, (sig, a[:60])
            d = d.replace(a, b)
        res[post] = hashlib.md5(d.encode()).hexdigest()
    creates = re.findall(r'^(CREATE FUNCTION .*?\n\$function\$;)', text.split('DO $subs$')[0], re.S | re.M)
    tags = ['@@NEW_TABLES@@', '@@NEW_CLAIMANTS@@', '@@NEW_EVENTS@@']
    sigs = ['public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)',
            'smarter_private.tournament_bounty_claimant_tables(uuid,uuid,jsonb)',
            'smarter_private.cancellation_lane_for_events(uuid[])']
    for tag, sig, c in zip(tags, sigs, creates):
        res[tag] = q(f"BEGIN; {c}\nSELECT md5(pg_get_functiondef('{sig}'::regprocedure)); ROLLBACK;", db).splitlines()[-1]
    return res


try:
    subprocess.run(as_owner + [str(pg / 'initdb'), '-D', str(cluster / 'data'), '-U', 'postgres', '-A', 'trust',
                               '--no-locale'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-l', str(LOG), '-o',
                   f"-k {sock} -p {PORT} -c listen_addresses='' -c log_lock_waits=on -c deadlock_timeout=200ms "
                   "-c max_connections=80 -c fsync=off -c full_page_writes=off", '-w', 'start'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'createdb'), '-h', str(sock), '-p', PORT, '-U', 'postgres', 'w'],
                   check=True, env=env)

    if args.print_post_images:
        install('w')
        psql(MIG_T1.read_text())
        psql(mig_t2_native)
        psql(migration)
        for sig, h in subs_post_images('w', migration2).items():
            print(sig, h)
        raise SystemExit(0)

    if args.print_e2_post_images:
        install('w')
        psql(MIG_T1.read_text())
        psql(mig_t2_native)
        psql(migration)
        psql(migration2)
        apply_lane_l('w')
        e2_install('w')
        if os.environ.get('E2_DUMP'):
            pathlib.Path(os.environ['E2_DUMP']).write_text(json.dumps([
                {'signature': sig, 'definition': psql(f"SELECT pg_get_functiondef('{sig}'::regprocedure)", 'w').stdout[:-1]}
                for sig in ('smarter_private.cancellation_lane(uuid)', 'public.fn_ca_settlement_lane_doctrine()')]))
        for tag, h in e2_post_images('w', migration_e2).items():
            print(tag, h)
        raise SystemExit(0)

    install('w')
    check(f'pre-images are byte-identical to production ({len(fix)} md5s)', True)
    base = invariants('seeded field')

    # ── BEFORE: production bodies ─────────────────────────────────────────
    u = bust('pending', TBL[0])
    hold = bg(rebuy_sql(u, 'pending', hold=2.0))
    wait_until_holding('rebuy', hold)
    held_x = q(f"SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='rebuy' "
               f"AND l.locktype='advisory' AND l.mode='ExclusiveLock' AND l.granted "
               f"AND (l.classid::bigint<<32 | l.objid::bigint) = ({TKEY} & x'ffffffffffffffff'::bigint)")
    jobs = {'wait_lane_T3': w_wait(TBL[3]), 'share_lane_T4': w_share(TBL[4]), 'hand_commit_T5': w_settle(TBL[5])}
    res = {}
    ths = [threading.Thread(target=lambda k, s: res.__setitem__(k, timed(s)), args=kv) for kv in jobs.items()]
    [t.start() for t in ths]
    [t.join() for t in ths]
    rb = finish(hold)
    check('before: the production rebuy completes (fixture is faithful)', rb[1] == 0 and 't' in rb[2], rb[2][-300:])
    check('before: the production rebuy holds its event lane T(id) EXCLUSIVE', held_x == '1', held_x)
    for k, (dt, rc, o) in res.items():
        check(f'before: {k} on another table WAITS for the rebuy (the defect)', dt >= 1.2, f'{dt:.2f}s rc={rc}')
    results['before'] = {k: round(v[0], 3) for k, v in res.items()}
    invariants('before')

    # ── Install lane T, then this migration ───────────────────────────────
    psql(MIG_T1.read_text())
    psql(mig_t2_native)
    check('lane T (20261118160405, 20261118171613) installs natively', True)
    refusal = psql(migration.replace("'08f84155a603076693d56f086add0b77'", "'00000000000000000000000000000000'"),
                   check=False)
    check('the migration refuses when lane T is not its pinned text', refusal.returncode != 0
          and 'must be installed first' in refusal.stderr, refusal.stderr.strip()[-160:])
    p = psql(migration, check=False)
    check('migration 20261118191946 installs (pre-image pins, anchors, post-image pins, doctrine ok)',
          p.returncode == 0, p.stderr.strip()[-600:])
    doctrine = q("SELECT public.fn_ca_settlement_lane_doctrine()")
    check('doctrine holds after the change, rule 6 included', json.loads(doctrine)['ok'] is True, doctrine)
    again = psql(migration, check=False)
    check('the migration refuses to run twice', again.returncode != 0, again.stderr.strip()[-160:])

    # ── AFTER 1: the per-hand calls proceed at once ───────────────────────
    u = bust('pending', TBL[0])
    hold = bg(rebuy_sql(u, 'pending', hold=2.0))
    wait_until_holding('rebuy', hold)
    modes = q(f"SELECT string_agg(l.mode, ',' ORDER BY l.mode) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid "
              f"WHERE a.application_name='rebuy' AND l.locktype='advisory' AND l.granted "
              f"AND (l.classid::bigint<<32 | l.objid::bigint) = ({TKEY} & x'ffffffffffffffff'::bigint)")
    check('after: a rebuy in flight holds its event lane T(id) SHARED only', modes == 'ShareLock', modes)
    res = {}
    jobs = {'wait_lane_T3': w_wait(TBL[3]), 'share_lane_T4': w_share(TBL[4]), 'hand_commit_T5': w_settle(TBL[5]),
            'wait_lane_own_table_T0': w_wait(TBL[0])}
    ths = [threading.Thread(target=lambda k, s: res.__setitem__(k, timed(s)), args=kv) for kv in jobs.items()]
    [t.start() for t in ths]
    [t.join() for t in ths]
    rb = finish(hold)
    check('after: the rebuy completes on the shared lane', rb[1] == 0 and 't' in rb[2], rb[2][-300:])
    for k, (dt, rc, o) in res.items():
        check(f'after: {k} proceeds at once while the rebuy is in flight', rc == 0 and dt < 0.5, f'{dt:.3f}s rc={rc} {o[-120:]}')
    results['after'] = {k: round(v[0], 3) for k, v in res.items()}
    invariants('after: rebuy beside hands')

    # Two rebuys of one event serialise on R(id), never on the tables.
    u1, u2 = bust('pending', TBL[1]), bust('pending', TBL[2])
    h1 = bg(rebuy_sql(u1, 'pending', hold=1.0, app='rebuy1'))
    wait_until_holding('rebuy1', h1)
    h2 = bg(rebuy_sql(u2, 'pending', app='rebuy2'))
    hand = timed(w_settle(TBL[4]))
    r1, r2 = finish(h1), finish(h2)
    check('after: two rebuys of one event serialise on R(id) and both land',
          r1[1] == 0 and r2[1] == 0 and r2[0] >= 0.7, f'second took {r2[0]:.2f}s')
    check('after: a hand runs at once while one rebuy holds R(id) and another waits for it',
          hand[1] == 0 and hand[0] < 0.5, f'{hand[0]:.3f}s')
    invariants('after: two rebuys')

    # ── AFTER 2: a rebuy racing a balancing move into its destination table ──
    # Table 5 is emptied to two chairs before each race, and the mover comes
    # from the fullest table, so the re-entry's chooser picks table 5 in either
    # order and the two really race for the same table.
    dest = TBL[5]

    def live_on(table):
        return q(f"SELECT string_agg(user_id::text, ',' ORDER BY seat_number) FROM public.table_seats "
                 f"WHERE table_id='{table}' AND left_at IS NULL AND stack>0").split(',')

    def fullest():
        return q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' AND tb.id<>'{dest}' ORDER BY "
                 f"(SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL) DESC, tb.id LIMIT 1")

    def emptiest_other():
        return q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' AND tb.id<>'{dest}' ORDER BY "
                 f"(SELECT count(*) FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL), tb.id LIMIT 1")

    for order in ('rebuy-first', 'move-first'):
        while int(q(f"SELECT count(*) FROM public.table_seats WHERE table_id='{dest}' AND left_at IS NULL")) > 2:
            psql(w_move(live_on(dest)[0], emptiest_other()))
        ue = bust('eliminated', TBL[3])
        mover = live_on(fullest())[0]
        if order == 'rebuy-first':
            first, second = bg(rebuy_sql(ue, 'eliminated', hold=1.2)), None
            wait_until_holding('rebuy', first)
            second = bg(w_move(mover, dest))
        else:
            first = bg(w_move(mover, dest, hold=1.2))
            wait_until_holding('move', first)
            second = bg(rebuy_sql(ue, 'eliminated'))
        a, b = finish(first), finish(second)
        seat_r = q(f"SELECT table_id||':'||seat_number FROM public.table_seats WHERE user_id='{ue}' AND left_at IS NULL")
        seat_m = q(f"SELECT table_id||':'||seat_number FROM public.table_seats WHERE user_id='{mover}' AND left_at IS NULL")
        check(f'after: rebuy vs balancing move ({order}) serialise: both land, the second waited, different chairs',
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and seat_r != seat_m and seat_r.startswith(dest)
              and seat_m.startswith(dest), f'second {b[0]:.2f}s rebuy={seat_r} move={seat_m} {a[2][-150:]} {b[2][-150:]}')
        invariants(f'after: rebuy vs move ({order})')

    # ── AFTER 3: a rebuy racing a hand settlement on its destination table ──
    for order in ('rebuy-first', 'hand-first'):
        dest = q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' ORDER BY (SELECT count(*) "
                 f"FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL), tb.created_at, tb.id LIMIT 1")
        ue = bust('eliminated', TBL[1] if dest != TBL[1] else TBL[2])
        if order == 'rebuy-first':
            first = bg(rebuy_sql(ue, 'eliminated', hold=1.2))
            wait_until_holding('rebuy', first)
            second = bg(w_settle(dest))
        else:
            first = bg(w_settle(dest, hold=1.2))
            wait_until_holding('hand', first)
            second = bg(rebuy_sql(ue, 'eliminated'))
        a, b = finish(first), finish(second)
        seat_r = q(f"SELECT table_id FROM public.table_seats WHERE user_id='{ue}' AND left_at IS NULL")
        check(f'after: rebuy vs hand settlement on its destination table ({order}) serialise on the table row',
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and seat_r == dest,
              f'second {b[0]:.2f}s seat={seat_r} dest={dest} {a[2][-150:]} {b[2][-150:]}')
        invariants(f'after: rebuy vs hand ({order})')

    # ── AFTER 4: nothing else acquires a chair without exclusive authority ──
    stranger = uid('d0d0d0d0', 1)
    psql(f"INSERT INTO public.profiles VALUES ('{stranger}', false); "
         f"INSERT INTO public.tournament_players(tournament_id,user_id,club_id,status,chips) "
         f"VALUES ('{TR}','{stranger}','{CLUB}','registered',0);")
    seat_sql = (f"INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,joined_at,club_id) "
                f"VALUES ('{TBL[4]}','{stranger}',9,0,'active',now(),'{CLUB}');")
    refusals = {
        'T shared only': f"BEGIN; SELECT public.fn_ca_share_settlement_lane_for_table('{TBL[4]}'); {seat_sql} COMMIT;",
        'forged marker with T shared, no R': (
            f"BEGIN; SELECT pg_advisory_xact_lock_shared({TKEY}); "
            f"SELECT set_config('ca.tournament_rebuy_lane', '{TR}:{stranger}:'||txid_current(), true); {seat_sql} COMMIT;"),
        "another player's rebuy lane": (
            f"BEGIN; SELECT public.fn_ca_share_tournament_lane_for_rebuy('{TR}','{uid('c0c0c0c0', 1)}'); {seat_sql} COMMIT;"),
        'marker from another transaction': (
            f"SELECT set_config('ca.tournament_rebuy_lane', '{TR}:{stranger}:1', false); BEGIN; "
            f"SELECT pg_advisory_xact_lock(hashtextextended('ca:tournament-rebuy-lane:v1:{TR}',0)); "
            f"SELECT pg_advisory_xact_lock_shared({TKEY}); {seat_sql} COMMIT;"),
    }
    # With a hand of the event in flight (T shared held elsewhere), as in play:
    # alone, a direct writer's F06 try would simply take T exclusive.
    bystander = bg(w_settle(TBL[2], hold=8.0, app='bystander'))
    wait_until_holding('bystander', bystander)
    for k, sql in refusals.items():
        dt, rc, o = timed(sql)
        root = 'TOURNAMENT_SEAT_ACQUISITION_REQUIRES_TERMINAL_AUTHORITY' in o
        f06 = 'F06_RETRY_CANONICAL_LANE' in o
        # A rebuy lane (any player's) passes the event-scoped F06 check, so the
        # chair guard itself must be the one that refuses another player's chair.
        want = root if 'rebuy lane' in k else (root or f06)
        check(f'after: a chair is refused without exclusive authority ({k})', rc != 0 and want,
              ('seat root guard' if root else 'F06 source guard') + ': ' + o[-140:])
    # The player's own lane, but a hand holds the destination table: refused, not raced.
    hold = bg(w_settle(TBL[4], hold=1.5))
    wait_until_holding('hand', hold)
    dt, rc, o = timed(f"BEGIN; SELECT public.fn_ca_share_tournament_lane_for_rebuy('{TR}','{stranger}'); {seat_sql} COMMIT;")
    finish(hold)
    check("after: the rebuy proof without the destination table's row is refused at once (NOWAIT)",
          rc != 0 and dt < 0.5 and 'TOURNAMENT_SEAT_ACQUISITION_REQUIRES_TERMINAL_AUTHORITY' in o, f'{dt:.3f}s {o[-120:]}')
    dt, rc, o = timed(f"BEGIN; SELECT public.fn_ca_lock_tournament_rebuy_acquisition('{TR}','{TBL[4]}','{stranger}'); COMMIT;")
    check('after: the rebuy seat root refuses a caller without the shared rebuy lane',
          rc != 0 and 'TOURNAMENT_REBUY_LANE_REQUIRED' in o, o[-120:])
    # A non-rebuy roster coordinate write under T shared still tries the exclusive lane.
    hold = bg(w_settle(TBL[3], hold=1.5))
    wait_until_holding('hand', hold)
    dt, rc, o = timed(f"BEGIN; SELECT public.fn_ca_share_settlement_lane_for_table('{TBL[4]}'); "
                      f"UPDATE public.tournament_players SET table_id='{TBL[4]}', seat_number=9 "
                      f"WHERE tournament_id='{TR}' AND user_id='{stranger}'; COMMIT;")
    finish(hold)
    check('after: a non-rebuy roster move under T shared is still refused by the F06 source guard',
          rc != 0 and 'F06_RETRY_CANONICAL_LANE' in o, o[-120:])
    finish(bystander)
    psql(f"DELETE FROM public.tournament_players WHERE user_id='{stranger}'; DELETE FROM public.profiles WHERE id='{stranger}';")
    # A bounty event keeps the rolling lane (its prior bounty generation settles under seat-exit authority).
    body = q("SELECT prosrc FROM pg_proc WHERE proname='process_tournament_rebuy'")
    check('after: the only exclusive-lane call left in the rebuy is the bounty/PKO/mystery branch',
          body.count('fn_ca_lock_settlement_lane_for_tournament(') == 1
          and re.search(r"is_mystery_bounty,false\)\)\) THEN\s+PERFORM public\.fn_ca_lock_settlement_lane_for_tournament", body)
          is not None)
    invariants('after: refusals')

    # ── AFTER 5: a mixed concurrent run, zero deadlocks ───────────────────
    log_before = LOG.read_text().count('deadlock detected')
    rng = random.Random(75013)
    pending = [(bust('pending', TBL[rng.randrange(NT)]), 'pending') for _ in range(10)]
    elim = [(bust('eliminated', TBL[rng.randrange(NT)]), 'eliminated') for _ in range(10)]
    rebuys = pending + elim
    rng.shuffle(rebuys)
    outcomes = {'rebuy': [], 'hand': [], 'move': [], 'wait': []}
    lock = threading.Lock()

    def worker(kind, items):
        for sql in items:
            dt, rc, o = timed(sql)
            with lock:
                outcomes[kind].append((rc, round(dt, 3), o[:300] if rc else ''))

    hand_jobs = [[w_settle(TBL[rng.randrange(NT)], amount=rng.randrange(1, 9)) for _ in range(40)] for _ in range(6)]
    wait_jobs = [[w_wait(TBL[rng.randrange(NT)]) for _ in range(40)] for _ in range(2)]
    movers = [pu for (pu, t, s) in PLAYERS][::5]
    move_jobs = [[w_move(m, TBL[rng.randrange(NT)]) for m in movers[i::2]] for i in range(2)]
    rebuy_jobs = [[rebuy_sql(u, k) for (u, k) in rebuys[i::4]] for i in range(4)]
    ths = ([threading.Thread(target=worker, args=('hand', j)) for j in hand_jobs]
           + [threading.Thread(target=worker, args=('wait', j)) for j in wait_jobs]
           + [threading.Thread(target=worker, args=('move', j)) for j in move_jobs]
           + [threading.Thread(target=worker, args=('rebuy', j)) for j in rebuy_jobs])
    t0 = time.monotonic()
    [t.start() for t in ths]
    [t.join() for t in ths]
    total = sum(len(v) for v in outcomes.values())
    deadlocks = LOG.read_text().count('deadlock detected') - log_before
    failed = {k: [x for x in v if x[0] != 0] for k, v in outcomes.items()}
    results['mixed'] = {'transactions': total, 'seconds': round(time.monotonic() - t0, 2), 'deadlocks': deadlocks,
                        'failures': {k: len(v) for k, v in failed.items()},
                        'hand_p100_s': max(x[1] for x in outcomes['hand'])}
    check(f'mixed run: {total} transactions (20 rebuys, 240 hand commits, 80 card writes, '
          f'{len(movers)} balancing moves), 0 deadlocks', deadlocks == 0, results['mixed'])
    check('mixed run: every rebuy, hand, card write and move committed', all(not v for v in failed.values()),
          {k: v[:2] for k, v in failed.items() if v})
    landed = q(f"SELECT count(*) FROM public.tournament_knockout_candidates WHERE state='rebought' "
               f"AND eliminated_user_id IN ({','.join(repr(u) for u, _ in rebuys)})")
    check('mixed run: all 20 rebuys re-seated their players', landed == '20', landed)
    invariants('after: mixed run')

    # ══ LANE R2 (20261119011750): bounty rebuys and busts share the lane ══
    # Four empty tables join the event so the field has chairs to fill.
    extra = [uid('a1a1a1a1', i) for i in range(4)]
    psql("INSERT INTO public.tables(id, tournament_id, club_id) VALUES "
         + ', '.join(f"('{t}','{TR}','{CLUB}')" for t in extra) + ';')
    TBL.extend(extra)

    def t_mode(app):
        return q(f"SELECT COALESCE(string_agg(l.mode, ',' ORDER BY l.mode),'none') FROM pg_locks l "
                 f"JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='{app}' AND l.locktype='advisory' "
                 f"AND l.granted AND (l.classid::bigint<<32 | l.objid::bigint) = ({TKEY} & x'ffffffffffffffff'::bigint)")

    def probe(label, holder_sql, app, busy, waits):
        """Hold `holder_sql` in flight; time a card write, an F06 share and a
        hand commit on the tables in `busy`. Before the fix they wait for it
        (waits=True), after it they do not."""
        hold = bg(holder_sql)
        wait_until_holding(app, hold)
        mode = t_mode(app)
        res = {}
        jobs = {f'wait_lane_{busy[0][-2:]}': w_wait(busy[0]), f'share_lane_{busy[1][-2:]}': w_share(busy[1]),
                f'hand_commit_{busy[2][-2:]}': w_settle(busy[2])}
        ths = [threading.Thread(target=lambda k, sq: res.__setitem__(k, timed(sq)), args=kv) for kv in jobs.items()]
        [t.start() for t in ths]
        [t.join() for t in ths]
        done = finish(hold)
        check(f'{label}: it completes', done[1] == 0 and 't' in done[2], done[2][-300:])
        if waits:
            check(f'{label}: it holds its event lane T(id) EXCLUSIVE (the defect)', 'ExclusiveLock' in mode, mode)
            for k, (dt, rc, o) in res.items():
                check(f'{label}: {k} on another table WAITS for it (the defect)', dt >= 1.2, f'{dt:.2f}s rc={rc}')
        else:
            check(f'{label}: it holds its event lane T(id) SHARED only', mode == 'ShareLock', mode)
            for k, (dt, rc, o) in res.items():
                check(f'{label}: {k} on another table proceeds at once', rc == 0 and dt < 0.5,
                      f'{dt:.3f}s rc={rc} {o[-120:]}')
        return {k: round(v[0], 3) for k, v in res.items()}

    def far_tables(*near):
        return [t for t in TBL if t not in near][:3]

    def seat_of(u):
        return q(f"SELECT table_id FROM public.table_seats WHERE user_id='{u}' AND left_at IS NULL")

    def live_player_at(table):
        return q(f"SELECT user_id FROM public.table_seats WHERE table_id='{table}' AND left_at IS NULL AND stack>0 "
                 f"ORDER BY id LIMIT 1")

    def emptiest():
        return q(f"SELECT tb.id FROM public.tables tb WHERE tb.tournament_id='{TR}' ORDER BY (SELECT count(*) "
                 f"FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL), tb.created_at, tb.id LIMIT 1")

    def set_bounty(on):
        psql(f"UPDATE public.tournaments SET is_bounty={'true' if on else 'false'}, bounty_amount={4 if on else 0} "
             f"WHERE id='{TR}';")

    # ── BEFORE R2 (20261118191946 only): a bust and a bounty rebuy pause the event ──
    u = bust_closed(TBL[0])
    results['r2_before_elimination'] = probe('before R2: a bust being recorded', elim_sql(u, hold=2.0), 'elim',
                                             far_tables(TBL[0]), True)
    set_bounty(True)
    k = live_player_at(TBL[1])
    u = bust_bounty(TBL[1], k)
    results['r2_before_bounty_rebuy'] = probe('before R2: a bounty rebuy', rebuy_sql(u, 'eliminated', hold=2.0),
                                              'rebuy', far_tables(TBL[1], seat_of(k), emptiest()), True)
    set_bounty(False)
    invariants('before R2')

    p = psql(migration2, check=False)
    check('migration 20261119011750 installs (pre-image pins, anchors, post-image pins, doctrine ok)',
          p.returncode == 0, p.stderr.strip()[-600:])
    doctrine = q("SELECT public.fn_ca_settlement_lane_doctrine()")
    check('doctrine holds after R2, rule 6 naming the three callers and four proofs', json.loads(doctrine)['ok'] is True,
          doctrine)
    body = q("SELECT prosrc FROM pg_proc WHERE proname='process_tournament_rebuy'")
    check('after R2: the rebuy takes no exclusive event lane in any format',
          'fn_ca_lock_settlement_lane_for_tournament(' not in body and 'fn_ca_lock_tournament_seat_acquisition(' not in body)

    # ── AFTER R2 1: a bust never pauses the event ─────────────────────────
    u = bust_closed(TBL[0])
    results['r2_after_elimination'] = probe('after R2: a bust being recorded', elim_sql(u, hold=2.0), 'elim',
                                            far_tables(TBL[0]), False)
    check('after R2: the bust is recorded (eliminated, chair left, table count)',
          q(f"SELECT status FROM public.tournament_players WHERE user_id='{u}'") == 'eliminated' and seat_of(u) == '')
    invariants('after R2: bust beside hands')
    for order in ('bust-first', 'hand-first'):
        table = TBL[2]
        u = bust_closed(table)
        if order == 'bust-first':
            first = bg(elim_sql(u, hold=1.2))
            wait_until_holding('elim', first)
            second = bg(w_settle(table))
        else:
            first = bg(w_settle(table, hold=1.2))
            wait_until_holding('hand', first)
            second = bg(elim_sql(u))
        a, b = finish(first), finish(second)
        check(f'after R2: a bust vs a hand of its own table ({order}) serialise on the table row',
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and seat_of(u) == '', f'second {b[0]:.2f}s {a[2][-120:]} {b[2][-120:]}')
        invariants(f'after R2: bust vs hand ({order})')

    # ── AFTER R2 2: a bounty rebuy never pauses the event ─────────────────
    set_bounty(True)
    k = live_player_at(TBL[1])
    u = bust_bounty(TBL[1], k)
    results['r2_after_bounty_rebuy'] = probe('after R2: a bounty rebuy', rebuy_sql(u, 'eliminated', hold=2.0), 'rebuy',
                                             far_tables(TBL[1], seat_of(k), emptiest()), False)
    check('after R2: the bounty rebuy paid the old head to its knocker and re-seated the player',
          q(f"SELECT count(*) FROM public.bounty_paid b JOIN public.tournament_bounty_obligations o ON o.id=b.obligation_id "
            f"WHERE o.eliminated_user_id='{u}' AND b.user_id='{k}'") == '1' and seat_of(u) != ''
          and float(q(f"SELECT current_bounty FROM public.tournament_players WHERE user_id='{u}'")) == 4.0,
          q(f"SELECT current_bounty FROM public.tournament_players WHERE user_id='{u}'"))
    invariants('after R2: bounty rebuy beside hands')
    # The knocker sits at the emptiest table, which the re-entry then chooses:
    # the bounty settlement writes the knocker's roster row and the hand of that
    # table writes it too. They serialise on the table row, in both orders.
    for order in ('rebuy-first', 'hand-first'):
        y = emptiest()
        k = live_player_at(y) or live_player_at(TBL[3])
        if seat_of(k) != y:
            psql(w_move(k, y))
        u = bust_bounty(TBL[3], k)
        if order == 'rebuy-first':
            first = bg(rebuy_sql(u, 'eliminated', hold=1.2))
            wait_until_holding('rebuy', first)
            second = bg(w_settle(y))
        else:
            first = bg(w_settle(y, hold=1.2))
            wait_until_holding('hand', first)
            second = bg(rebuy_sql(u, 'eliminated'))
        a, b = finish(first), finish(second)
        check(f"after R2: a bounty rebuy vs a hand of its knocker's table ({order}) serialise, no deadlock",
              a[1] == 0 and b[1] == 0 and b[0] >= 0.8 and seat_of(k) == y,
              f'second {b[0]:.2f}s dest={seat_of(u) == y} {a[2][-150:]} {b[2][-150:]}')
        invariants(f'after R2: bounty rebuy vs knocker hand ({order})')

    # ── AFTER R2 3: mixed concurrent runs, zero deadlocks ─────────────────
    def mixed(label, field_jobs, n_hands=30):
        log0 = LOG.read_text().count('deadlock detected')
        outcomes.clear()
        outcomes.update({'field': [], 'hand': [], 'move': [], 'wait': []})
        hj = [[w_settle(TBL[rng.randrange(len(TBL))], amount=rng.randrange(1, 9)) for _ in range(n_hands)] for _ in range(6)]
        wj = [[w_wait(TBL[rng.randrange(len(TBL))]) for _ in range(n_hands)] for _ in range(2)]
        mv = [pu for (pu, t, s2) in PLAYERS if seat_of(pu)][::7]
        mj = [[w_move(m, TBL[rng.randrange(len(TBL))]) for m in mv[i::2]] for i in range(2)]
        ths = ([threading.Thread(target=worker, args=('hand', j)) for j in hj]
               + [threading.Thread(target=worker, args=('wait', j)) for j in wj]
               + [threading.Thread(target=worker, args=('move', j)) for j in mj]
               + [threading.Thread(target=worker, args=('field', j)) for j in field_jobs])
        t0 = time.monotonic()
        [t.start() for t in ths]
        [t.join() for t in ths]
        total = sum(len(v) for v in outcomes.values())
        dl = LOG.read_text().count('deadlock detected') - log0
        failed = {kk: [x for x in v if x[0] != 0] for kk, v in outcomes.items()}
        res = {'transactions': total, 'seconds': round(time.monotonic() - t0, 2), 'deadlocks': dl,
               'failures': {kk: len(v) for kk, v in failed.items()}}
        check(f'{label}: {total} transactions, 0 deadlocks', dl == 0, res)
        check(f'{label}: every transaction committed', all(not v for v in failed.values()),
              {kk: v[:2] for kk, v in failed.items() if v})
        return res

    set_bounty(False)
    busts = [bust_closed(TBL[rng.randrange(len(TBL))]) for _ in range(8)]
    reb = [(bust('pending', TBL[rng.randrange(len(TBL))]), 'pending') for _ in range(4)] + \
          [(bust('eliminated', TBL[rng.randrange(len(TBL))]), 'eliminated') for _ in range(4)]
    field = [elim_sql(b) for b in busts] + [rebuy_sql(uu, kk) for (uu, kk) in reb]
    rng.shuffle(field)
    results['r2_mixed_busts'] = mixed('R2 mixed run (8 busts, 8 rebuys, hands, card writes, moves)',
                                      [field[i::4] for i in range(4)])
    check('R2 mixed run: all 8 busts recorded',
          q(f"SELECT count(*) FROM public.tournament_players WHERE status='eliminated' AND user_id IN "
            f"({','.join(repr(b) for b in busts)})") == '8')
    invariants('after R2: mixed busts')
    set_bounty(True)
    bb = []
    for _ in range(10):
        kk = live_player_at(TBL[rng.randrange(len(TBL))])
        if kk:
            bb.append(bust_bounty(TBL[rng.randrange(len(TBL))], kk))
    results['r2_mixed_bounty'] = mixed(f'R2 mixed bounty run ({len(bb)} bounty rebuys, hands, card writes, moves)',
                                       [[rebuy_sql(uu, 'eliminated') for uu in bb[i::3]] for i in range(3)])
    check('R2 mixed bounty run: every old head paid once and every player re-seated',
          q(f"SELECT count(*) FROM public.tournament_bounty_obligations WHERE state='settled' AND eliminated_user_id IN "
            f"({','.join(repr(b) for b in bb)})") == str(len(bb))
          and all(seat_of(b) for b in bb))
    final = invariants('after R2: mixed bounty run')

    # == LANE B7 (20261119013430): the production bounty rebuy path ========
    # R2's sections above stub the bust claim and the seat-first sync, and its
    # hand commit (w_settle) takes no tournament row and no 'atomic-table:'
    # key. Production's bounty rebuy of a still-open generation runs the claim
    # (B3: 418 of 418 rebuys in an hour), the claim runs the real sync, and a
    # real hand commit takes G, T(id) shared, the tournament row FOR SHARE,
    # its table row, then 'atomic-table:'<table>, then its roster rows.
    psql("DROP FUNCTION public.fn_sync_seat_first_player_count(uuid); "
         "ALTER TABLE public.tournaments ADD COLUMN format_contract text, ADD COLUMN current_players int DEFAULT 0; "
         "CREATE FUNCTION public.fn_ca_tournament_recorded_format(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'mtt-v1'::text $$; "
         "CREATE FUNCTION public.fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; "
         "CREATE TABLE public.b7_knockers(eliminated_user_id uuid PRIMARY KEY, knocker uuid);")
    for f in fix_b7:
        assert hashlib.md5(f['definition'].encode()).hexdigest() == f['md5'], f['signature']
        psql(f['definition'])
        assert q(f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))") == f['md5'], f['signature']
    check(f'B7: the real seat-first sync and its two readers are byte-identical to production ({len(fix_b7)} md5s)', True)
    # The bust claim's lock shape for a still-open generation (tournament,
    # busted roster row, its candidates, the obligation it writes, the zero
    # chair it retires, its table's count, then the seat-first sync).
    psql("""CREATE OR REPLACE FUNCTION public.fn_claim_bounty_legacy_candidate_20260907(p_t uuid, p_u uuid, p_pos integer,
  p_prize numeric, p_table uuid, p_hand uuid, p_hn bigint, p_joined timestamptz, p_k uuid, p_c jsonb, p_r numeric, p_a boolean)
 RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE k uuid; o uuid := gen_random_uuid(); h numeric;
BEGIN
  PERFORM 1 FROM public.tournaments WHERE id=p_t FOR UPDATE;
  SELECT current_bounty INTO h FROM public.tournament_players WHERE tournament_id=p_t AND user_id=p_u FOR UPDATE;
  PERFORM 1 FROM public.tournament_knockout_candidates WHERE tournament_id=p_t AND eliminated_user_id=p_u
   ORDER BY hand_number, id FOR UPDATE;
  SELECT knocker INTO k FROM public.b7_knockers WHERE eliminated_user_id=p_u;
  INSERT INTO public.tournament_bounty_obligations(id,tournament_id,eliminated_user_id,hand_number,hand_id,state,
    table_id,seat_joined_at,mode,claimants,head_amount,knocker_user_id)
  VALUES (o,p_t,p_u,p_hn,p_hand,'pending',p_table,p_joined,'regular',
    jsonb_build_array(jsonb_build_object('user_id',k)),h,k);
  UPDATE public.tournament_players SET status='eliminated', position=p_pos, table_id=NULL, seat_number=NULL
   WHERE tournament_id=p_t AND user_id=p_u AND status='playing';
  UPDATE public.table_seats SET left_at=clock_timestamp(), status='left'
   WHERE table_id=p_table AND user_id=p_u AND left_at IS NULL;
  UPDATE public.tables SET current_players=(SELECT count(*) FROM public.table_seats s
    WHERE s.table_id=p_table AND s.left_at IS NULL) WHERE id=p_table;
  PERFORM public.fn_sync_seat_first_player_count(p_t);
  RETURN jsonb_build_object('ok',true,'claimed',true,'obligation_id',o,'mode','regular');
END $$;""")

    def bust_pending_bounty(table, head=4):
        """A still-open bust in a bounty event: its head (funded from its
        wallet into the pool) goes to a live player of the same table."""
        knocker = live_player_at(table)
        uu = bust('pending', table)
        psql(f"""
UPDATE public.club_members SET chip_balance=chip_balance-{head} WHERE user_id='{uu}';
INSERT INTO public.wallet_transactions(user_id,wallet_type,type,amount,category,related_entity_id)
  VALUES ('{uu}','PLAYER','debit',{head},'bounty_head','{TR}');
UPDATE public.tournaments SET bounty_pool=bounty_pool+{head} WHERE id='{TR}';
UPDATE public.tournament_players SET current_bounty={head} WHERE user_id='{uu}';
INSERT INTO public.b7_knockers VALUES ('{uu}','{knocker}');""")
        return uu, knocker, seat_of(uu)

    def w_commit(table, hold=0.0, app='commit'):
        """A hand commit in production's lock order: the shared lane, the
        tournament row FOR SHARE, the table row, [hold], the table's
        'atomic-table:' key, then a zero-sum move between two of its chairs."""
        return (f"SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='6s'; "
                f"SELECT public.fn_ca_share_settlement_lane_for_table('{table}'); "
                f"SELECT 1 FROM public.tournaments WHERE id='{TR}' FOR SHARE; "
                f"SELECT 1 FROM public.tables WHERE id='{table}' FOR UPDATE; "
                + (f"SELECT pg_sleep({hold}); " if hold else '') +
                f"SELECT pg_advisory_xact_lock(hashtextextended('atomic-table:'||'{table}',0)); "
                f"WITH two AS (SELECT s.id, row_number() OVER (ORDER BY s.id) rn FROM public.table_seats s "
                f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.stack>3 ORDER BY s.id LIMIT 2) "
                f"UPDATE public.table_seats s SET stack=s.stack+CASE two.rn WHEN 1 THEN 3 ELSE -3 END "
                f"  FROM two WHERE s.id=two.id AND (SELECT count(*) FROM two)=2; "
                f"UPDATE public.tournament_players tp SET chips=s.stack FROM public.table_seats s "
                f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.user_id=tp.user_id "
                f"  AND tp.tournament_id='{TR}' AND tp.chips IS DISTINCT FROM s.stack::int; COMMIT;")

    def deadlocks():
        return LOG.read_text().count('deadlock detected')

    def cycle_race(label, expect_deadlock):
        """A hand of the busted player's own table holds the tournament row and
        its table row while a still-open bounty rebuy of that table starts."""
        uu, kk, x = bust_pending_bounty(TBL[2])  # x: the table its zero chair sits at
        d0 = deadlocks()
        h = bg(w_commit(x, hold=1.0))
        wait_until_holding('commit', h)
        rb = bg(rebuy_sql(uu, 'pending'))
        a, b = finish(h), finish(rb)
        dl = deadlocks() - d0
        if expect_deadlock:
            check(f'{label}: a hand commit of its own table and the rebuy DEADLOCK (the defect)',
                  dl >= 1 and (a[1] != 0 or b[1] != 0), f'deadlocks={dl} hand rc={a[1]} rebuy rc={b[1]} {a[2][-160:]} {b[2][-160:]}')
            if b[1] != 0:  # the purchase is idempotent: the player retries it
                b = timed(rebuy_sql(uu, 'pending'))
        else:
            check(f'{label}: a hand commit of its own table and the rebuy serialise, 0 deadlocks',
                  dl == 0 and a[1] == 0 and b[1] == 0 and b[0] >= 0.6, f'deadlocks={dl} rebuy {b[0]:.2f}s {a[2][-160:]} {b[2][-160:]}')
        check(f'{label}: the head is paid to its knocker exactly once and the player is seated again',
              q(f"SELECT count(*) FROM public.bounty_paid b JOIN public.tournament_bounty_obligations o ON o.id=b.obligation_id "
                f"WHERE o.eliminated_user_id='{uu}' AND b.user_id='{kk}'") == '1' and seat_of(uu) != '', seat_of(uu))
        invariants(label)
        return dl

    def field_pause(label, waits):
        """Hold a still-open bounty rebuy in flight; time a hand begin (F06
        share) and a card write at two tables that are not its own."""
        uu, kk, x = bust_pending_bounty(TBL[4])
        hold = bg(rebuy_sql(uu, 'pending', hold=2.0))
        wait_until_holding('rebuy', hold)
        others = [t for t in TBL[:9] if t not in (x, seat_of(kk))][:2]
        res = {}
        jobs = {f'f06_begin_{others[0][-2:]}': w_share(others[0]), f'card_write_{others[1][-2:]}': w_wait(others[1])}
        ths = [threading.Thread(target=lambda kx, sq: res.__setitem__(kx, timed(sq)), args=kv) for kv in jobs.items()]
        [t.start() for t in ths]
        [t.join() for t in ths]
        done = finish(hold)
        check(f'{label}: the still-open bounty rebuy completes', done[1] == 0 and 't' in done[2], done[2][-300:])
        for kx, (dt, rc, o) in res.items():
            if waits and kx.startswith('f06_begin'):
                check(f'{label}: {kx} on another table WAITS for it (the field-wide sync lock)', dt >= 1.2,
                      f'{dt:.2f}s rc={rc}')
            else:
                check(f'{label}: {kx} on another table proceeds at once', rc == 0 and dt < 0.5,
                      f'{dt:.3f}s rc={rc} {o[-120:]}')
        invariants(label)
        return {kx: round(v[0], 3) for kx, v in res.items()}

    set_bounty(True)
    # ── BEFORE B7 (R2 live): the field-wide lock and the crossing key ───────
    results['b7_before_field'] = field_pause('before B7: a still-open bounty rebuy', True)
    results['b7_before_cycle_deadlocks'] = cycle_race('before B7', True)

    p = psql(migration3.replace("'b76daaf8587cca4eeac91ec39e9e7ce3'", "'00000000000000000000000000000000'"), check=False)
    check('the B7 migration refuses when lane R2 is not its pinned text', p.returncode != 0
          and 'must be installed first' in p.stderr, p.stderr.strip()[-160:])
    p = psql(migration3, check=False)
    check('migration 20261119013430 installs (pre-image pins, anchors, post-image pins, key order, doctrine ok)',
          p.returncode == 0, p.stderr.strip()[-600:])
    check('the B7 migration refuses to run twice', psql(migration3, check=False).returncode != 0)

    # ── AFTER B7 ───────────────────────────────────────────────────────────
    results['b7_after_field'] = field_pause('after B7: a still-open bounty rebuy', False)
    cycle_race('after B7 (hand first)', False)
    # rebuy first: the hand commit waits on the tournament row, not on the key
    uu, kk, x = bust_pending_bounty(TBL[2])
    d0 = deadlocks()
    rb = bg(rebuy_sql(uu, 'pending', hold=1.0))
    wait_until_holding('rebuy', rb)
    h = bg(w_commit(x))
    a, b = finish(rb), finish(h)
    check('after B7 (rebuy first): the hand commit of its own table waits for it, 0 deadlocks',
          deadlocks() == d0 and a[1] == 0 and b[1] == 0 and b[0] >= 0.6, f'hand {b[0]:.2f}s {a[2][-160:]} {b[2][-160:]}')
    invariants('after B7 (rebuy first)')
    # The residual: a hand commit of ANOTHER table waits for the rebuy's
    # tournament row; the rebuy's own time is what it costs.
    uu, kk, _ = bust_pending_bounty(TBL[5])
    t_reb = timed(rebuy_sql(uu, 'pending'))
    check('after B7: an unheld still-open bounty rebuy commits', t_reb[1] == 0, t_reb[2][-200:])
    results['b7_rebuy_seconds_unheld'] = round(t_reb[0], 3)
    # The settle's bound: a wallet row its payout needs is held elsewhere.
    uu, kk, _ = bust_pending_bounty(TBL[6])
    blocker = bg(f"SET application_name='wallet'; BEGIN; SELECT 1 FROM public.club_members WHERE user_id='{kk}' FOR UPDATE; "
                 f"SELECT pg_sleep(2.0); COMMIT;")
    wait_until_holding('wallet', blocker)
    dt, rc, o = timed(rebuy_sql(uu, 'pending'))
    finish(blocker)
    check('after B7: a settle that waits over 500 ms aborts only the purchase, retryable 55P03 PLAYER_BUSY',
          rc != 0 and dt < 1.5 and 'TOURNAMENT_PURCHASE_PLAYER_BUSY' in o, f'{dt:.2f}s {o[-200:]}')
    check('after B7: nothing of the refused purchase was written (no head paid, no seat)',
          q(f"SELECT count(*) FROM public.bounty_paid b JOIN public.tournament_bounty_obligations o ON o.id=b.obligation_id "
            f"WHERE o.eliminated_user_id='{uu}'") == '0'
          and q(f"SELECT state FROM public.tournament_knockout_candidates WHERE eliminated_user_id='{uu}'") == 'pending')
    dt, rc, o = timed(rebuy_sql(uu, 'pending'))
    check('after B7: the same purchase retried commits once, head paid once',
          rc == 0 and q(f"SELECT count(*) FROM public.bounty_paid b JOIN public.tournament_bounty_obligations o "
                        f"ON o.id=b.obligation_id WHERE o.eliminated_user_id='{uu}'") == '1', o[-200:])
    invariants('after B7: bounded settle')
    body = q("SELECT prosrc FROM pg_proc WHERE proname='process_tournament_rebuy'")
    check('after B7: every atomic-table key in the rebuy follows its tournament row',
          body.find("hashtextextended('atomic-table:'") > body.find("WHERE t.id=p_tournament_id FOR UPDATE;")
          and body.rfind("hashtextextended('atomic-table:'") > body.find('fn_ca_lock_tournament_rebuy_acquisition('))

    # ── AFTER B7: mixed run on production's lock order ─────────────────────
    d0 = deadlocks()
    outcomes.clear()
    outcomes.update({'rebuy': [], 'commit': [], 'share': [], 'wait': []})
    pend = []
    for i in range(12):
        t = TBL[i % 9]
        if live_player_at(t):
            pend.append(bust_pending_bounty(t)[0])

    def rebuy_worker(items):
        for uu in items:
            for attempt in range(5):  # the engine's bounded in-place retry of PLAYER_BUSY
                dt, rc, o = timed(rebuy_sql(uu, 'pending'))
                if rc == 0 or 'TOURNAMENT_PURCHASE_PLAYER_BUSY' not in o:
                    break
                time.sleep(0.1 * (attempt + 1))
            with lock:
                outcomes['rebuy'].append((rc, round(dt, 3), o[:300] if rc else ''))

    cj = [[w_commit(TBL[rng.randrange(9)]) for _ in range(25)] for _ in range(6)]
    sj = [[w_share(TBL[rng.randrange(9)]) for _ in range(25)] for _ in range(2)]
    wj = [[w_wait(TBL[rng.randrange(9)]) for _ in range(25)] for _ in range(2)]
    ths = ([threading.Thread(target=worker, args=('commit', j)) for j in cj]
           + [threading.Thread(target=worker, args=('share', j)) for j in sj]
           + [threading.Thread(target=worker, args=('wait', j)) for j in wj]
           + [threading.Thread(target=rebuy_worker, args=(pend[i::3],)) for i in range(3)])
    t0 = time.monotonic()
    [t.start() for t in ths]
    [t.join() for t in ths]
    total = sum(len(v) for v in outcomes.values())
    dl = deadlocks() - d0
    failed = {kk: [x for x in v if x[0] != 0] for kk, v in outcomes.items()}
    results['b7_mixed'] = {'transactions': total, 'seconds': round(time.monotonic() - t0, 2), 'deadlocks': dl,
                           'failures': {kk: len(v) for kk, v in failed.items()},
                           'commit_p100_s': max(x[1] for x in outcomes['commit']),
                           'share_p100_s': max(x[1] for x in outcomes['share'])}
    check(f'B7 mixed run ({len(pend)} still-open bounty rebuys, production-order hand commits, F06 begins, '
          f'card writes): {total} transactions, 0 deadlocks', dl == 0, results['b7_mixed'])
    check('B7 mixed run: every transaction committed', all(not v for v in failed.values()),
          {kk: v[:2] for kk, v in failed.items() if v})
    check('B7 mixed run: every old head paid exactly once and every player re-seated',
          q(f"SELECT count(*) FROM public.tournament_bounty_obligations o WHERE o.state='settled' AND o.eliminated_user_id IN "
            f"({','.join(repr(b) for b in pend)}) AND (SELECT count(*) FROM public.bounty_paid b WHERE b.obligation_id=o.id)=1")
          == str(len(pend)) and all(seat_of(b) for b in pend))
    final = invariants('after B7: mixed run')

    # ══ LANE E2 (20261119053909): a move, a break step, the entry close, a
    #    bounty sweep and a single-event cancel fence only their own event
    #    and the tables they touch ══════════════════════════════════════════
    apply_lane_l('w')
    check('E2: lane L (20261119052513) installs natively first, as on production', True)
    for sig, want in (('smarter_private.cancellation_lane(uuid)', 'd66f767af93b4c9e93c42bcc9472005e'),
                      ('public.fn_ca_settlement_lane_doctrine()', 'd1c13960687824de74bf3836e7b54259'),
                      ('public.fn_ca_lock_settlement_lane_for_event(uuid,boolean)', 'a85d48e2b4bd0420520fa9697df6a147')):
        got = q(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))")
        check(f'E2: {sig} as installed natively by lanes T, R2 and L is the production text', got == want, got)
    e2_install('w')
    check(f'E2: pre-images are byte-identical to production ({len(fix_e2)} md5s), the second event and a cash table seeded',
          True)
    # Four more empty tables, so moves and a break have chairs to go to.
    more = [uid('a3a3a3a3', i) for i in range(4)]
    psql("INSERT INTO public.tables(id, tournament_id, club_id) VALUES "
         + ', '.join(f"('{t}','{TR}','{CLUB}')" for t in more) + ';')
    TBL.extend(more)
    set_bounty(False)
    psql(f"UPDATE public.tournaments SET is_bounty=true, bounty_amount=4 WHERE id='{TR}';")
    # The earlier sections leave busted players in their zero-stack chairs
    # (rebuy windows still open). They leave the felt here, under the event's
    # exclusive lane, so every table can be broken or balanced: no chips move.
    psql(f"""BEGIN; SELECT public.fn_ca_lock_settlement_lane_for_tournament('{TR}');
UPDATE public.tournament_players tp SET status='eliminated', table_id=NULL, seat_number=NULL, rebuy_prompt_until=NULL
  FROM public.table_seats s WHERE s.user_id=tp.user_id AND s.left_at IS NULL AND s.stack<=0 AND tp.tournament_id='{TR}';
UPDATE public.table_seats s SET left_at=now(), status='left' FROM public.tables tb
 WHERE tb.id=s.table_id AND tb.tournament_id='{TR}' AND s.left_at IS NULL AND s.stack<=0;
UPDATE public.tables tb SET current_players=(SELECT count(*) FROM public.table_seats s
 WHERE s.table_id=tb.id AND s.left_at IS NULL) WHERE tb.tournament_id='{TR}';
COMMIT;""")

    def seats_of(table):
        return q(f"SELECT count(*) FROM public.table_seats WHERE table_id='{table}' AND left_at IS NULL")

    def free_chair(table):
        return q(f"SELECT min(n) FROM generate_series(1,9) n WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s "
                 f"WHERE s.table_id='{table}' AND s.seat_number=n AND s.left_at IS NULL) AND NOT EXISTS (SELECT 1 "
                 f"FROM public.tournament_players tp WHERE tp.tournament_id='{TR}' AND tp.table_id='{table}' "
                 f"AND tp.seat_number=n AND tp.status IN ('registered','playing'))")

    def clean_tables(k=3, avoid=()):
        """Tables of the event whose every chair is funded and mirrored (no
        pending bust), fewest players first: a break source or a move."""
        rows = q(f"SELECT string_agg(id::text, ',' ORDER BY n, id) FROM (SELECT tb.id, (SELECT count(*) FROM "
                 f"public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL) n FROM public.tables tb "
                 f"WHERE tb.tournament_id='{TR}' AND lower(tb.status)<>'closed' "
                 f"AND NOT (tb.id::text = ANY (ARRAY[{','.join(repr(a) for a in avoid) or "''"}])) "
                 f"AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.table_id=tb.id AND s.left_at IS NULL "
                 f"AND s.stack<=0) AND EXISTS (SELECT 1 FROM public.table_seats s WHERE s.table_id=tb.id "
                 f"AND s.left_at IS NULL)) x").split(',')
        return [t for t in rows if t][:k]

    def move_sql(u, src, dst, chair=None, hold=0.0, app='move'):
        chair = chair or free_chair(dst)
        return (f"SET application_name='{app}'; BEGIN; SELECT public.fn_move_tournament_player('{TR}','{u}','{src}',"
                f"'{dst}',{chair},gen_random_uuid(),'live_source')->>'ok'; "
                + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")

    def mgr(sql_body, hold=0.0, app='e2', tid=TR):
        return (f"SET application_name='{app}'; BEGIN; SET LOCAL app.smarter_data_actor='tournament-manager'; "
                f"SET LOCAL app.smarter_tournament_id='{tid}'; SET LOCAL app.smarter_tournament_lease_generation='{GEN}'; "
                f"{sql_body} " + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")

    def park_sql(break_id, table, hold=0.0, app='park'):
        lc = q(f"SELECT f06_lifecycle FROM public.tables WHERE id='{table}'")
        return mgr(f"SELECT public.fn_f06_request_park('{TR}','{GEN}','{break_id}','{table}',{lc},gen_random_uuid())->>'ok';",
                   hold, app)

    def begin_sql(break_id, src, dests, hold=0.0, app='begin'):
        """The whole roster of `src`, each member to the next free chair of
        `dests` in turn, as the balancer's manifest."""
        rows = json.loads(q(f"SELECT COALESCE(json_agg(json_build_object('user_id',s.user_id,'source_seat_id',s.id,"
                            f"'source_seat_number',s.seat_number,'occupancy_id',s.occupancy_id) ORDER BY s.user_id),'[]') "
                            f"FROM public.table_seats s WHERE s.table_id='{src}' AND s.left_at IS NULL"))
        used = {}
        for i, r in enumerate(rows):
            chair = ''
            for k2 in range(len(dests)):
                d = dests[(i + k2) % len(dests)]
                taken = used.setdefault(d, set())
                chair = q(f"SELECT min(n) FROM generate_series(1,9) n WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s "
                          f"WHERE s.table_id='{d}' AND s.seat_number=n AND s.left_at IS NULL) "
                          f"AND n NOT IN ({','.join(map(str, taken)) or '0'})")
                if chair:
                    break
            chair = int(chair)
            taken.add(chair)
            r.update({'request_id': q('SELECT gen_random_uuid()'), 'destination_table_id': d,
                      'destination_seat_number': chair})
        members = json.dumps(rows).replace("'", "''")
        return mgr(f"SELECT public.fn_f06_begin_break('{TR}','{GEN}','{break_id}','{members}'::jsonb)->>'ok';", hold, app), rows

    def discover_sql(hold=0.0, app='scan'):
        rev = q(f"SELECT COALESCE((SELECT revision FROM smarter_private.f06_cursors WHERE tournament_id='{TR}'),0)")
        return mgr(f"SELECT public.fn_f06_discover_breaks('{TR}','{GEN}',{rev},8)->>'ok';", hold, app)

    def close_sql(tid, hold=0.0, app='close'):
        return (f"SET application_name='{app}'; BEGIN; SELECT public.fn_close_tournament_entry_window('{tid}')->>'ok'; "
                + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")

    def sweep_sql(hold=0.0, app='sweep'):
        return (f"SET application_name='{app}'; BEGIN; SELECT public.fn_sweep_pending_tournament_bounties('{TR}',20)->>'ok'; "
                + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")

    def settle_other(table, tid, amount=5, hold=0.0, app='hand2'):
        """A hand commit on another event's table (its own roster mirror), or a
        cash hand commit when tid is None."""
        mirror = (f"UPDATE public.tournament_players tp SET chips=s.stack FROM public.table_seats s "
                  f"WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.user_id=tp.user_id AND tp.tournament_id='{tid}'; "
                  if tid else '')
        return (f"SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='4s'; "
                f"SELECT public.fn_ca_share_settlement_lane_for_table('{table}'); "
                f"SELECT 1 FROM public.tables WHERE id='{table}' FOR UPDATE; "
                f"WITH two AS (SELECT s.id, row_number() OVER (ORDER BY s.id) rn FROM public.table_seats s "
                f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.stack>{amount} ORDER BY s.id LIMIT 2) "
                f"UPDATE public.table_seats s SET stack=s.stack+CASE two.rn WHEN 1 THEN {amount} ELSE -{amount} END "
                f"  FROM two WHERE s.id=two.id AND (SELECT count(*) FROM two)=2; {mirror}"
                + (f"SELECT pg_sleep({hold}); " if hold else '') + "COMMIT;")

    def race(label, first_sql, first_app, second_sql, want_wait=True):
        first = bg(first_sql)
        wait_until_holding(first_app, first)
        if want_wait:
            second = bg(second_sql)
            a, b = finish(first), finish(second)
        else:
            b = timed(second_sql)
            a = finish(first)
        ok = a[1] == 0 and b[1] == 0 and ((b[0] >= 0.8) if want_wait else (b[0] < 0.5))
        check(label, ok, f'second {b[0]:.2f}s {a[2][-160:]} | {b[2][-160:]}')
        return a, b

    def e2_probe(label, holder_sql, app, near, waits, takes_event_row=True):
        """Hold a change of the event in flight; time a card write, an F06 share
        (hand begin, finish, continuation) and a hand commit in production's
        lock order on three tables it does not touch, a hand of the second
        event and a cash hand commit. A hand commit reads the event row FOR
        SHARE first, so it waits for a holder of that row (a move's chair needs
        it FOR UPDATE through the launch proof, as a rebuy's does) for the
        holder's own duration; the probe's holder sleeps 2 s to make every
        wait visible."""
        far = [t for t in TBL if t not in near and q(f"SELECT lower(status) FROM public.tables WHERE id='{t}'") != 'closed'
               and int(seats_of(t)) >= 2][:3]
        hold = bg(holder_sql)
        wait_until_holding(app, hold)
        mode = t_mode(app)
        jobs = {'card_write': w_wait(far[0]), 'f06_share': w_share(far[1]), 'hand_commit': w_commit(far[2], app='probe'),
                'other_event_hand': settle_other(TBL2[0], TR2), 'cash_hand': settle_other(CASH, None)}
        res = {}
        ths = [threading.Thread(target=lambda k, sq: res.__setitem__(k, timed(sq)), args=kv) for kv in jobs.items()]
        [t.start() for t in ths]
        [t.join() for t in ths]
        done = finish(hold)
        check(f'{label}: it completes', done[1] == 0 and 't' in done[2], done[2][-300:])
        if waits:
            check(f'{label}: it holds its event lane T(id) EXCLUSIVE (the defect)', 'ExclusiveLock' in mode, mode)
            for k in ('card_write', 'f06_share', 'hand_commit'):
                dt, rc, o = res[k]
                check(f'{label}: {k} on an untouched table WAITS for it (the defect)', dt >= 1.2, f'{dt:.2f}s rc={rc}')
        else:
            check(f'{label}: it holds its event lane T(id) SHARED or not at all', mode in ('ShareLock', 'none'), mode)
            for k in ('card_write', 'f06_share'):
                dt, rc, o = res[k]
                check(f'{label}: {k} on an untouched table proceeds at once', rc == 0 and dt < 0.5,
                      f'{dt:.3f}s rc={rc} {o[-120:]}')
            dt, rc, o = res['hand_commit']
            if takes_event_row:
                check(f'{label}: a hand commit on an untouched table waits only for the event row, then commits',
                      rc == 0, f'{dt:.3f}s rc={rc} {o[-120:]}')
            else:
                check(f'{label}: hand_commit on an untouched table proceeds at once', rc == 0 and dt < 0.5,
                      f'{dt:.3f}s rc={rc} {o[-120:]}')
        for k in ('other_event_hand', 'cash_hand'):
            dt, rc, o = res[k]
            check(f'{label}: {k} proceeds at once', rc == 0 and dt < 0.5, f'{dt:.3f}s rc={rc} {o[-120:]}')
        return {k: round(v[0], 3) for k, v in res.items()}, mode

    def e2_invariants(label):
        invariants(label)
        r = json.loads(q(f"""SELECT json_build_object(
 'tr2_felt', (SELECT COALESCE(sum(s.stack),0) FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
              WHERE tb.tournament_id='{TR2}' AND s.left_at IS NULL),
 'tr2_mirror', (SELECT COALESCE(sum(chips),0) FROM public.tournament_players WHERE tournament_id='{TR2}' AND status='playing'),
 'tr2_supply', (SELECT count(*)*1000 FROM public.tournament_players WHERE tournament_id='{TR2}' AND status='playing'),
 'cash_felt', (SELECT COALESCE(sum(stack),0) FROM public.table_seats WHERE table_id='{CASH}' AND left_at IS NULL),
 'source_chairs_not_emptied', (SELECT count(*) FROM public.tournament_seat_move_receipts r JOIN public.table_seats s
              ON s.id=r.source_seat_id WHERE s.user_id=r.user_id AND s.joined_at<r.moved_at
              AND (s.left_at IS NULL OR s.stack<>0)))"""))
        check(f'{label}: the second event and the cash table conserved, every moved chair emptied',
              r['tr2_felt'] == r['tr2_mirror'] == r['tr2_supply'] and r['cash_felt'] == 1000
              and r['source_chairs_not_emptied'] == 0, r)

    # ── BEFORE E2: each of them pauses every table of the event ──────────
    e2_before = {}
    a, b = clean_tables(2)
    m = live_player_at(a)
    e2_before['move'] = e2_probe('before E2: a balancing move', move_sql(m, a, b, hold=2.0), 'move', [a, b], True)[0]
    src = clean_tables(1, avoid=(a, b))[0]
    brk = q('SELECT gen_random_uuid()')
    e2_before['park'] = e2_probe('before E2: a break parking its table', park_sql(brk, src, hold=2.0), 'park', [src], True)[0]
    psql("DELETE FROM smarter_private.f06_operations;")
    e2_before['scan'] = e2_probe('before E2: the break scan', discover_sql(hold=2.0), 'scan', [], True)[0]
    e2_before['close'] = e2_probe('before E2: the entry-window close', close_sql(TR, hold=2.0), 'close', [], True)[0]
    k = live_player_at(clean_tables(1)[0])
    ub = bust_bounty(seat_of(k), k)
    e2_before['sweep'] = e2_probe('before E2: a bounty sweep', sweep_sql(hold=2.0), 'sweep', [seat_of(k)], True)[0]
    # The cancel of one event: production's standalone mode takes G and B
    # exclusive, so another event's tables and the cash table wait for it.
    hold = bg(f"SET application_name='cancel'; BEGIN; SELECT public.e2_cancel_event('{TR2}', 0); SELECT pg_sleep(2.0); ROLLBACK;")
    wait_until_holding('cancel', hold)
    res = {}
    jobs = {'other_event_card': w_wait(TBL[0]), 'cash_hand': settle_other(CASH, None)}
    ths = [threading.Thread(target=lambda kk, sq: res.__setitem__(kk, timed(sq)), args=kv) for kv in jobs.items()]
    [t.start() for t in ths]
    [t.join() for t in ths]
    done = finish(hold)
    check('before E2: one event\'s cancel takes the platform lane (it completes)', done[1] == 0 and 't' in done[2], done[2][-200:])
    for kk, (dt, rc, o) in res.items():
        check(f'before E2: {kk} WAITS for one other event\'s cancel (the defect)', dt >= 1.2, f'{dt:.2f}s rc={rc}')
    e2_before['cancel'] = {kk: round(v[0], 3) for kk, v in res.items()}
    results['e2_before'] = e2_before
    e2_invariants('before E2')

    # ── Install E2 ────────────────────────────────────────────────────────
    refusal = psql(migration_e2.replace("'b76daaf8587cca4eeac91ec39e9e7ce3'", "'00000000000000000000000000000000'"), check=False)
    check('E2: the migration refuses when lane R2 is not its pinned text', refusal.returncode != 0
          and 'must be installed first' in refusal.stderr, refusal.stderr.strip()[-160:])
    p = psql(migration_e2, check=False)
    check('migration 20261119053909 installs (pre-image pins, anchors, post-image pins, doctrine ok)',
          p.returncode == 0, p.stderr.strip()[-600:])
    doctrine = q("SELECT public.fn_ca_settlement_lane_doctrine()")
    check('E2: doctrine holds, rule 8 included', json.loads(doctrine)['ok'] is True, doctrine)
    again = psql(migration_e2, check=False)
    check('E2: the migration refuses to run twice', again.returncode != 0, again.stderr.strip()[-160:])
    psql("CREATE FUNCTION public.e2_drift() RETURNS void LANGUAGE plpgsql AS $$ BEGIN "
         f"PERFORM public.fn_ca_share_tournament_lane_for_tables('{TR}',NULL,NULL); END $$;")
    drift = json.loads(q("SELECT public.fn_ca_settlement_lane_doctrine()"))
    check('E2: doctrine rule 8 names an unreviewed caller of the event lane',
          drift['ok'] is False and any(v['rule'] == 'an_event_change_fences_only_its_own_tables' for v in drift['violations']),
          drift['violations'])
    psql("DROP FUNCTION public.e2_drift();")

    # ── AFTER E2 1: none of them pauses an untouched table ───────────────
    e2_after = {}
    a, b = clean_tables(2)
    m = live_player_at(a)
    e2_after['move'], mode = e2_probe('after E2: a balancing move', move_sql(m, a, b, hold=2.0), 'move', [a, b], False)
    check('after E2: the move landed with its receipt', seat_of(m) == b and q(
        f"SELECT count(*) FROM public.tournament_seat_move_receipts WHERE user_id='{m}' AND destination_table_id='{b}'") != '0')
    e2_invariants('after E2: move beside hands')
    # A whole table break: park, begin, every member moved, the table closed.
    src = clean_tables(1)[0]
    dests = q(f"SELECT string_agg(id::text, ',' ORDER BY n, id) FROM (SELECT tb.id, (SELECT count(*) FROM public.table_seats s "
              f"WHERE s.table_id=tb.id AND s.left_at IS NULL) n FROM public.tables tb WHERE tb.tournament_id='{TR}' "
              f"AND lower(tb.status)<>'closed' AND tb.id<>'{src}') x WHERE n<8").split(',')[:3]
    brk = q('SELECT gen_random_uuid()')
    e2_after['park'], _ = e2_probe('after E2: a break parking its table', park_sql(brk, src, hold=2.0), 'park',
                                   [src] + dests, False)
    bsql, members = begin_sql(brk, src, dests, hold=2.0)
    e2_after['begin'], _ = e2_probe('after E2: a break beginning (its manifest)', bsql, 'begin', [src] + dests, False)
    check('after E2: the break began with the whole roster of its table',
          q(f"SELECT state FROM smarter_private.f06_operations WHERE break_id='{brk}'") == 'begun'
          and q(f"SELECT count(*) FROM smarter_private.f06_members WHERE break_id='{brk}'") == str(len(members)), members)
    # Its first member moves while a hand runs at a far table and the
    # destination table's hand waits for the move (and the move for a hand).
    first = members[0]
    dst = first['destination_table_id']
    mv = (f"SET application_name='bmove'; BEGIN; SELECT public.fn_move_tournament_player('{TR}','{first['user_id']}',"
          f"'{src}','{dst}',{first['destination_seat_number']},'{first['request_id']}','live_source')->>'ok'; "
          f"SELECT pg_sleep(1.2); COMMIT;")
    race('after E2: a break move vs a hand of its destination table (move first): the hand waits on the table row',
         mv, 'bmove', w_commit(dst))
    far = [t for t in TBL if t not in [src] + dests and int(seats_of(t)) >= 2][0]
    race('after E2: a break move vs a hand begin (F06 share) at an untouched table: it does not wait',
         mv.replace(first['request_id'], members[1]['request_id']).replace(first['user_id'], members[1]['user_id'])
           .replace(f"'{dst}',{first['destination_seat_number']}",
                    f"'{members[1]['destination_table_id']}',{members[1]['destination_seat_number']}"),
         'bmove', w_share(far), want_wait=False)
    for mm in members[2:]:
        d = timed(f"BEGIN; SELECT public.fn_move_tournament_player('{TR}','{mm['user_id']}','{src}',"
                  f"'{mm['destination_table_id']}',{mm['destination_seat_number']},'{mm['request_id']}','live_source')->>'ok'; COMMIT;")
        check(f"after E2: break member {mm['user_id'][-4:]} moved", d[1] == 0 and 'true' in d[2], d[2][-200:])
    cl = timed(mgr(f"SELECT public.fn_f06_close_break('{TR}','{GEN}','{brk}')->>'state';"))
    check('after E2: the broken table closes once every member has its winning receipt',
          cl[1] == 0 and 'close_confirmed' in cl[2] and q(f"SELECT lower(status) FROM public.tables WHERE id='{src}'") == 'closed'
          and seats_of(src) == '0', cl[2][-200:])
    e2_invariants('after E2: a whole table break')
    # The engine's acknowledgement (fn_f06_ack_cleanup) retires the custody record.
    psql("UPDATE smarter_private.f06_operations SET state='acknowledged' WHERE state='close_confirmed';")
    # A hand on the breaking table itself waits for a break step holding it.
    src2 = clean_tables(1)[0]
    race('after E2: a park vs a hand of the parked table: serialised on the table row',
         park_sql(q('SELECT gen_random_uuid()'), src2, hold=1.2), 'park', w_commit(src2))
    psql("DELETE FROM smarter_private.f06_operations WHERE state='park_requested';")

    e2_after['scan'], mode = e2_probe('after E2: the break scan', discover_sql(hold=2.0), 'scan', [], False,
                                      takes_event_row=False)
    check('after E2: the break scan takes no event lane at all', mode == 'none', mode)
    e2_after['close'], _ = e2_probe('after E2: the entry-window close', close_sql(TR, hold=2.0), 'close', [], False)
    psql(f"DELETE FROM public.e2_closed_windows; INSERT INTO public.e2_closed_windows VALUES ('{TR2}');")
    fin = timed(close_sql(TR2))
    check('after E2: the second event\'s entry close finalizes its pool on the shared lane',
          fin[1] == 0 and q(f"SELECT prize_pool_finalized FROM public.tournaments WHERE id='{TR2}'") == 't', fin[2][-200:])

    # ── AFTER E2 2: the bounty sweep ──────────────────────────────────────
    k = live_player_at(clean_tables(1)[0])
    ub = bust_bounty(clean_tables(1, avoid=(seat_of(k),))[0], k)
    e2_after['sweep'], mode = e2_probe('after E2: a bounty sweep', sweep_sql(hold=2.0), 'sweep', [seat_of(k)], False)
    check('after E2: the sweep paying a head holds its event lane T(id) shared', mode == 'ShareLock', mode)
    check('after E2: the sweep paid the pending head to its knocker exactly once',
          q(f"SELECT count(*) FROM public.bounty_paid WHERE obligation_id IN (SELECT id FROM public.tournament_bounty_obligations "
            f"WHERE eliminated_user_id='{ub}')") == '1'
          and q(f"SELECT state FROM public.tournament_bounty_obligations WHERE eliminated_user_id='{ub}'") == 'settled')
    e2_invariants('after E2: sweep beside hands')
    for order in ('sweep-first', 'hand-first'):
        y = clean_tables(1)[0]
        k = live_player_at(y)
        ub2 = bust_bounty(clean_tables(1, avoid=(y,))[0], k)
        if order == 'sweep-first':
            race("after E2: a sweep vs a hand of its knocker's table (sweep first) serialise on the table row",
                 sweep_sql(hold=1.2), 'sweep', w_commit(y))
        else:
            race("after E2: a sweep vs a hand of its knocker's table (hand first) serialise on the table row",
                 w_commit(y, hold=1.2), 'commit', sweep_sql())
        check(f'after E2: the {order} sweep paid its head once',
              q(f"SELECT count(*) FROM public.bounty_paid b JOIN public.tournament_bounty_obligations o ON o.id=b.obligation_id "
                f"WHERE o.eliminated_user_id='{ub2}' AND b.user_id='{k}'") == '1')
        e2_invariants(f'after E2: sweep vs knocker hand ({order})')
    hold = bg(f"SET application_name='busy'; BEGIN; SELECT public.fn_ca_share_tournament_lane_for_rebuy('{TR}','{uid('c0c0c0c0', 1)}'); SELECT pg_sleep(1.5); COMMIT;")
    wait_until_holding('busy', hold)
    dt, rc, o = timed(f"BEGIN; SELECT public.fn_sweep_pending_tournament_bounties('{TR}',20)->>'processed'; "
                      f"SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'; COMMIT;")
    finish(hold)
    check('after E2: a sweep never queues behind a busy event lane: it skips at once holding nothing of it',
          rc == 0 and dt < 0.5 and o.splitlines()[0] == '0', f'{dt:.3f}s {o}')

    # ── AFTER E2 3: the moves race their own tables' hands ───────────────
    for where in ('source', 'destination'):
        for order in ('move-first', 'hand-first'):
            a, b = clean_tables(2)
            m = live_player_at(a)
            table = a if where == 'source' else b
            chair = free_chair(b)
            if order == 'move-first':
                race(f'after E2: a move vs a hand of its {where} table ({order}) serialise on the table row',
                     move_sql(m, a, b, chair, hold=1.2), 'move', w_commit(table))
            else:
                race(f'after E2: a move vs a hand of its {where} table ({order}) serialise on the table row',
                     w_commit(table, hold=1.2), 'commit', move_sql(m, a, b, chair))
            check(f'after E2: the {where}/{order} move landed', seat_of(m) == b)
            e2_invariants(f'after E2: move vs {where} hand ({order})')

    # ── AFTER E2 4: one event's cancel fences that event only ────────────
    hold = bg(f"SET application_name='cancel'; BEGIN; SELECT public.e2_cancel_event('{TR2}', 0); SELECT pg_sleep(2.0); ROLLBACK;")
    wait_until_holding('cancel', hold)
    lane = q("SELECT string_agg(l.mode, ',' ORDER BY l.mode) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid "
             "WHERE a.application_name='cancel' AND l.locktype='advisory' AND l.granted "
             f"AND (l.classid::bigint<<32 | l.objid::bigint) IN ((hashtextextended('ca:tournament-terminal-settlement:v1',0) "
             f"& x'ffffffffffffffff'::bigint), (hashtextextended('ca:hand-settlement-barrier:v1',0) & x'ffffffffffffffff'::bigint))")
    jobs = {'other_event_card': w_wait(TBL[0]), 'other_event_hand': w_commit(TBL[1]), 'cash_hand': settle_other(CASH, None),
            'own_event_card': f"BEGIN; SET LOCAL lock_timeout='4s'; SELECT smarter_private.f06_wait_table_lane('{TBL2[1]}'); COMMIT;"}
    res = {}
    ths = [threading.Thread(target=lambda kk, sq: res.__setitem__(kk, timed(sq)), args=kv) for kv in jobs.items()]
    [t.start() for t in ths]
    [t.join() for t in ths]
    done = finish(hold)
    check('after E2: one event\'s cancel completes on its own lane', done[1] == 0 and 't' in done[2], done[2][-200:])
    check('after E2: it holds the platform key G and the barrier B only shared or not at all', 'ExclusiveLock' not in (lane or ''), lane)
    for kk in ('other_event_card', 'other_event_hand', 'cash_hand'):
        dt, rc, o = res[kk]
        check(f'after E2: {kk} proceeds at once while another event is cancelled', rc == 0 and dt < 0.5, f'{dt:.3f}s rc={rc} {o[-120:]}')
    dt, rc, o = res['own_event_card']
    check('after E2: the cancelled event\'s own card write waits for its cancel', dt >= 1.2, f'{dt:.2f}s rc={rc}')
    results['e2_cancel'] = {kk: round(v[0], 3) for kk, v in res.items()}
    hold = bg(w_commit(TBL[2], hold=1.5, app='bystander'))
    wait_until_holding('bystander', hold)
    dt, rc, o = timed(f"BEGIN; SELECT smarter_private.cancellation_lane_for_events(ARRAY['{TR}','{TR2}']::uuid[]); COMMIT;")
    finish(hold)
    check('after E2: a cancel of several events keeps the platform try and is refused, never queued, while a hand runs',
          rc != 0 and dt < 0.5 and 'CANCELLATION_BARRIER_BUSY' in o, f'{dt:.3f}s {o[-120:]}')
    dt, rc, o = timed(f"BEGIN; SELECT smarter_private.cancellation_lane_for_events(ARRAY['{TR}','{TR2}']::uuid[]); "
                      "SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND mode='ExclusiveLock'; COMMIT;")
    check('after E2: with the platform quiet, a cancel of several events holds G and B exclusive', rc == 0 and o.strip() == '2', o)
    e2_invariants('after E2: cancel')

    # ── AFTER E2 5: a mixed run, zero deadlocks ───────────────────────────
    movers = [live_player_at(t) for t in clean_tables(6)]
    movers = [mv_u for mv_u in movers if mv_u]
    pool = clean_tables(8)

    def rand_move(u):
        return (f"BEGIN; DO $mv$ DECLARE v_src uuid; v_dst uuid; v_chair int; BEGIN "
                f"SELECT table_id INTO v_src FROM public.table_seats WHERE user_id='{u}' AND left_at IS NULL; "
                f"SELECT id INTO v_dst FROM public.tables WHERE id = ANY(ARRAY[{','.join(repr(t) for t in pool)}]::uuid[]) "
                f"AND id<>v_src ORDER BY random() LIMIT 1; "
                f"SELECT min(n) INTO v_chair FROM generate_series(1,9) n WHERE NOT EXISTS (SELECT 1 FROM public.table_seats s "
                f"WHERE s.table_id=v_dst AND s.seat_number=n AND s.left_at IS NULL); "
                f"IF v_src IS NULL OR v_chair IS NULL THEN RETURN; END IF; "
                f"PERFORM public.fn_move_tournament_player('{TR}','{u}',v_src,v_dst,v_chair,gen_random_uuid(),'live_source'); "
                f"END $mv$; COMMIT;")

    outcomes.clear()
    for kk in ('hand', 'wait', 'move', 'field', 'sweep', 'scan', 'close', 'hand2'):
        outcomes[kk] = []
    log0 = LOG.read_text().count('deadlock detected')
    alive = [t for t in TBL if q(f"SELECT lower(status) FROM public.tables WHERE id='{t}'") != 'closed']
    # A bust hands its chips to a funded chair of its own table.
    dealt = [t for t in alive if int(seats_of(t)) >= 2]
    # Re-entries of bounty busts (the event is a bounty event here): each
    # settles its old head inside the shared lane while the sweep pays others.
    reb = [(bust_bounty(dealt[rng.randrange(len(dealt))], live_player_at(t)), 'eliminated')
           for t in clean_tables(4) if live_player_at(t)]
    hb = [bust_bounty(dealt[rng.randrange(len(dealt))], live_player_at(t)) for t in clean_tables(4) if live_player_at(t)]
    hj = [[w_commit(alive[rng.randrange(len(alive))]) for _ in range(25)] for _ in range(5)]
    wj = [[w_wait(alive[rng.randrange(len(alive))]) for _ in range(25)] for _ in range(2)]
    h2 = [[settle_other(TBL2[rng.randrange(3)], TR2) if rng.random() < 0.5 else settle_other(CASH, None) for _ in range(25)]]
    # Each worker moves its own players (a player is moved by one balancer at a time).
    mj = [[rand_move(movers[i::2][j % len(movers[i::2])]) for j in range(8)] for i in range(2)]
    fj = [[rebuy_sql(uu, kk2) for (uu, kk2) in reb]]
    sj = [[sweep_sql() for _ in range(6)]]
    cj = [[discover_sql() for _ in range(12)], [close_sql(TR) for _ in range(8)]]
    ths = ([threading.Thread(target=worker, args=('hand', j)) for j in hj]
           + [threading.Thread(target=worker, args=('wait', j)) for j in wj]
           + [threading.Thread(target=worker, args=('hand2', j)) for j in h2]
           + [threading.Thread(target=worker, args=('move', j)) for j in mj]
           + [threading.Thread(target=worker, args=('field', j)) for j in fj]
           + [threading.Thread(target=worker, args=('sweep', j)) for j in sj]
           + [threading.Thread(target=worker, args=('scan', cj[0])), threading.Thread(target=worker, args=('close', cj[1]))])
    t0 = time.monotonic()
    [t.start() for t in ths]
    [t.join() for t in ths]
    total = sum(len(v) for v in outcomes.values())
    dl = LOG.read_text().count('deadlock detected') - log0
    failed = {kk: [x for x in v if x[0] != 0] for kk, v in outcomes.items()}
    for _ in range(5):  # a sweep that found its lane busy skipped; the next one pays
        if q("SELECT count(*) FROM public.tournament_bounty_obligations WHERE state='pending'") == '0':
            break
        psql(sweep_sql())
    results['e2_mixed'] = {'transactions': total, 'seconds': round(time.monotonic() - t0, 2), 'deadlocks': dl,
                           'failures': {kk: len(v) for kk, v in failed.items()},
                           'counts': {kk: len(v) for kk, v in outcomes.items()},
                           'hand_commit_p100_s': max(x[1] for x in outcomes['hand']),
                           'move_p100_s': max(x[1] for x in outcomes['move'])}
    check(f'E2 mixed run: {total} transactions (real moves, sweeps, break scans, entry closes, rebuys, hands of two '
          f'events and cash, card writes), 0 deadlocks', dl == 0, results['e2_mixed'])
    # The run picks a move's chair before the move locks its tables, as the
    # engine's balancer does; a rebuy or another move can take that chair
    # first, and the move then refuses it under its own table row (23505),
    # writing nothing (seat or roster chair). That is the guard working;
    # every other outcome commits.
    taken = ('tournament move destination seat is occupied', 'tournament move destination roster is occupied')
    occupied = [x for x in failed['move'] if any(t in x[2] for t in taken)]
    failed['move'] = [x for x in failed['move'] if not any(t in x[2] for t in taken)]
    results['e2_mixed']['moves_refused_for_a_taken_chair'] = len(occupied)
    check('E2 mixed run: every transaction committed (a move refused only for a chair taken first)',
          all(not v for v in failed.values()), {kk: v[:2] for kk, v in failed.items() if v})
    check('E2 mixed run: every pending head paid exactly once',
          q(f"SELECT count(*) FROM public.tournament_bounty_obligations WHERE state='pending'") == '0'
          and q("SELECT count(*) FROM (SELECT obligation_id FROM public.bounty_paid GROUP BY 1 HAVING count(*)>1) d") == '0')
    e2_invariants('after E2: mixed run')
    results['e2_after'] = e2_after

    # ═══════════════════════════════════════════════════════════════════════
    # LANE E4 (20261119181500): TOURNAMENT TABLES NEVER WAIT ON ANOTHER
    # TABLE'S EVENT ROW (FOR KEY SHARE on hand commit + FOR NO KEY UPDATE on
    # shared-change-lane writers).
    # ═══════════════════════════════════════════════════════════════════════
    hand_auths = json.loads(FIX_HAND.read_text())
    hand_sigs = (
        'fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)',
        'fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)',
    )
    for it in hand_auths:
        if it.get('signature') in hand_sigs:
            psql(it['definition'])
            got_md5 = q(f"SELECT md5(pg_get_functiondef('public.{it['signature']}'::regprocedure))")
            check(f"E4 hand pre-image {it['signature'].split('(')[0]} matches production",
                  got_md5 == it['definition_md5'], f'{got_md5} != {it["definition_md5"]}')
    # Minimal stubs for E3's promo pre-check on tables not in the E2 harness
    psql("""
ALTER TABLE public.entry_purchase_idempotency_receipts
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE TABLE IF NOT EXISTS public.ca_promo_play_through_settings (id boolean PRIMARY KEY, enforced_from timestamptz);
CREATE TABLE IF NOT EXISTS public.ca_promo_play_through_grants (club_id uuid, user_id uuid, closed_at timestamptz);
CREATE TABLE IF NOT EXISTS public.ca_arena_settings (id int PRIMARY KEY, club_id uuid, tournaments_enabled boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS public.poker_diamond_custody (id uuid PRIMARY KEY, user_id uuid, purpose text, target_id uuid, state text);
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE OR REPLACE FUNCTION realtime.send(jsonb, text, text, boolean) RETURNS void LANGUAGE sql AS $$ SELECT; $$;
CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_state_ensure(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT; $$;
""")
    p = psql(MIG_E3.read_text(), check=False)
    check('migration 20261119054539 (E3) installs natively', p.returncode == 0, p.stderr.strip()[-400:])

    # BEFORE E4: a hand commit (FOR SHARE) at an untouched table WAITS for a
    # move at another table (which holds public.tournaments FOR UPDATE).
    e4_src_t, e4_dst_t, e4_untouched_t = clean_tables(3)
    e4_mover = live_player_at(e4_src_t)
    hold_move_before = bg(move_sql(e4_mover, e4_src_t, e4_dst_t, hold=1.6, app='e4_before'))
    wait_until_holding('e4_before', hold_move_before)
    dt_before, rc_before, o_before = timed(w_commit(e4_untouched_t))
    done_before = finish(hold_move_before)
    check('before E4: move completes', done_before[1] == 0, done_before[2][-200:])
    check('before E4: hand commit (FOR SHARE) on an untouched table WAITS for move (the defect)',
          rc_before == 0 and dt_before >= 1.0, f'{dt_before:.3f}s rc={rc_before} {o_before[-120:]}')

    # Install E4: refuses if E2/E3 missing, installs cleanly, refuses to run twice
    mig_e4 = MIG_E4.read_text()
    p = psql(mig_e4.replace("'76dddeb34b3508a48b777c2c79442072'", "'00000000000000000000000000000000'"), check=False)
    check('E4 refuses when lane E2/E3 is not its pinned text',
          p.returncode != 0 and 'must be installed first' in p.stderr, p.stderr.strip()[-160:])
    p = psql(mig_e4, check=False)
    check('migration 20261119181500 (E4) installs (all 19 pre/post pins, probes, doctrine rule 9 ok)',
          p.returncode == 0, p.stderr.strip()[-600:])
    check('E4 refuses to run twice', psql(mig_e4, check=False).returncode != 0)
    doc_e4 = q("SELECT public.fn_ca_settlement_lane_doctrine()")
    check('E4 doctrine holds after the change, rule 9 included', '"ok": true' in doc_e4, doc_e4)
    # Mirror E4's FOR NO KEY UPDATE on the two minimal test-harness stubs
    # (fn_collect_bounty_obligation and fn_claim_bounty_legacy_candidate_20260907)
    # whose real production counterparts delegate to fn_collect_bounty /
    # fn_claim_tournament_bounty_elimination (both downgraded by E4 above).
    psql("""
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_collect_bounty_obligation(uuid)'::regprocedure);
  EXECUTE replace(v_def, 'FROM public.tournaments WHERE id=o.tournament_id FOR UPDATE;', 'FROM public.tournaments WHERE id=o.tournament_id FOR NO KEY UPDATE;');
  v_def := pg_get_functiondef('public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)'::regprocedure);
  EXECUTE replace(v_def, 'FROM public.tournaments WHERE id=p_t FOR UPDATE;', 'FROM public.tournaments WHERE id=p_t FOR NO KEY UPDATE;');
END $$;
""")

    def w_commit_e4(table, hold=0.0, app='commit_e4'):
        """A hand commit after E4: G S, T(id) S, tournament row FOR KEY SHARE,
        table row FOR UPDATE, [hold], atomic-table key, zero-sum stack move.
        Emits in-DB commit latency in ms (HAND_SQL_MS=<float>) before COMMIT."""
        return (f"SET application_name='{app}'; BEGIN; SET LOCAL lock_timeout='6s'; "
                f"SELECT public.fn_ca_share_settlement_lane_for_table('{table}'); "
                f"SELECT 1 FROM public.tournaments WHERE id='{TR}' FOR KEY SHARE; "
                f"SELECT 1 FROM public.tables WHERE id='{table}' FOR UPDATE; "
                + (f"SELECT pg_sleep({hold}); " if hold else '') +
                f"SELECT pg_advisory_xact_lock(hashtextextended('atomic-table:'||'{table}',0)); "
                f"WITH two AS (SELECT s.id, row_number() OVER (ORDER BY s.id) rn FROM public.table_seats s "
                f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.stack>3 ORDER BY s.id LIMIT 2) "
                f"UPDATE public.table_seats s SET stack=s.stack+CASE two.rn WHEN 1 THEN 3 ELSE -3 END "
                f"  FROM two WHERE s.id=two.id AND (SELECT count(*) FROM two)=2; "
                f"UPDATE public.tournament_players tp SET chips=s.stack FROM public.table_seats s "
                f"  WHERE s.table_id='{table}' AND s.left_at IS NULL AND s.user_id=tp.user_id "
                f"  AND tp.tournament_id='{TR}' AND tp.chips IS DISTINCT FROM s.stack::int; "
                f"SELECT 'HAND_SQL_MS='||round(EXTRACT(EPOCH FROM (clock_timestamp()-transaction_timestamp()))*1000, 2); COMMIT;")

    e4_after = {}
    E4_MAX_WALL_S = 0.15
    E4_MAX_SQL_MS = 50.0

    def e4_untouched_check(label, holder_sql, app_name, untouched_table):
        h = bg(holder_sql)
        wait_until_holding(app_name, h)
        dt, rc, o = timed(w_commit_e4(untouched_table))
        done = finish(h)
        m_ms = re.search(r'HAND_SQL_MS=([0-9]+(?:\.[0-9]+)?)', o)
        sql_ms = float(m_ms.group(1)) if m_ms else 99999.0
        check(f'after E4: {label} completes', done[1] == 0, done[2][-240:])
        check(f'after E4: hand commit on untouched table proceeds AT ONCE (<50ms SQL, <150ms wall) while {label} is in flight',
              rc == 0 and sql_ms < E4_MAX_SQL_MS and dt < E4_MAX_WALL_S,
              f'sql={sql_ms:.2f}ms wall={dt:.3f}s rc={rc} {o[-120:]}')
        e4_after[label] = {'wall_s': round(dt, 3), 'sql_ms': round(sql_ms, 2)}

    # 1. Move in flight -> untouched table commits at once
    ct = clean_tables(3)
    mv_u = live_player_at(ct[0])
    e4_untouched_check('move', move_sql(mv_u, ct[0], ct[1], hold=1.6, app='e4_move'), 'e4_move', ct[2])
    # 2. Break park in flight -> untouched table commits at once
    ct = clean_tables(3)
    e4_parked_t = ct[0]
    e4_brk = q("SELECT gen_random_uuid()")
    e4_untouched_check('break_park', park_sql(e4_brk, e4_parked_t, hold=1.6, app='e4_park'), 'e4_park', ct[2])
    # 3. Bounty rebuy in flight -> untouched table commits at once
    ct = [t for t in clean_tables(8, avoid=(e4_parked_t,)) if live_player_at(t) and free_chair(t)][:4]
    rb_u, rb_k, rb_t = bust_pending_bounty(ct[0])
    rb_other = [t for t in ct if t not in (rb_t, seat_of(rb_k))][0]
    e4_untouched_check('bounty_rebuy', rebuy_sql(rb_u, 'pending', hold=1.6), 'rebuy', rb_other)
    # 4. Add-on in flight -> untouched table commits at once
    psql(f"""
UPDATE public.tournaments
   SET add_on_available = true,
       addon_period_triggered = true,
       addon_from_start = false,
       current_level = GREATEST(COALESCE(current_level, 3), COALESCE(late_reg_levels, rebuy_levels, 0)),
       addon_cost = 10,
       addon_chips = 1000,
       addon_levels = 99,
       addon_period_started_at = now() - interval '1 minute',
       addon_period_ends_at = now() + interval '10 minutes'
 WHERE id = '{TR}';
""")
    ct = clean_tables(3, avoid=(e4_parked_t,))
    ao_u = q(f"SELECT s.user_id FROM public.table_seats s JOIN public.tournament_players tp "
             f"ON tp.tournament_id='{TR}' AND tp.user_id=s.user_id "
             f"WHERE s.table_id='{ct[0]}' AND s.left_at IS NULL AND COALESCE(tp.add_on,false)=false LIMIT 1")
    e4_untouched_check(
        'addon',
        f"SET application_name='e4_addon'; BEGIN; SELECT public.process_tournament_rebuy('{TR}','{ao_u}','addon',10,1000,NULL,NULL)->>'success'; SELECT pg_sleep(1.6); COMMIT;",
        'e4_addon',
        ct[2],
    )
    # 5. Elimination (bust) in flight -> untouched table commits at once
    ct = clean_tables(3, avoid=(e4_parked_t,))
    el_u = live_player_at(ct[0])
    e4_untouched_check(
        'elimination',
        f"SET application_name='e4_bust'; BEGIN; SELECT public.fn_eliminate_tournament_player_atomic('{TR}','{el_u}',99,0,0); SELECT pg_sleep(1.6); COMMIT;",
        'e4_bust',
        ct[2],
    )
    # 6. Bounty sweep (cron sweep) in flight -> untouched table commits at once
    ct = clean_tables(4, avoid=(e4_parked_t,))
    sw_k = live_player_at(ct[1])
    bust_bounty(ct[0], sw_k)
    e4_untouched_check('bounty_sweep', sweep_sql(hold=1.6, app='e4_sweep'), 'e4_sweep', ct[2])
    # 7. Entry close in flight -> untouched table commits at once
    ct = clean_tables(3, avoid=(e4_parked_t,))
    e4_untouched_check('entry_close', close_sql(TR, hold=1.6, app='e4_close'), 'e4_close', ct[2])
    # 6. Touched table STILL serializes in BOTH orders (0 deadlocks)
    ct = clean_tables(3, avoid=(e4_parked_t,))
    mv_u2 = live_player_at(ct[0])
    d0 = deadlocks()
    h1 = bg(move_sql(mv_u2, ct[0], ct[1], hold=1.0, app='e4_race1'))
    wait_until_holding('e4_race1', h1)
    h2 = bg(w_commit_e4(ct[0]))
    r1, r2 = finish(h1), finish(h2)
    check('after E4: move vs hand on SAME source table (move-first) serializes on table row, 0 deadlocks',
          deadlocks() == d0 and r1[1] == 0 and r2[1] == 0 and r2[0] >= 0.6,
          f'dl={deadlocks()-d0} hand={r2[0]:.2f}s {r1[2][-120:]} {r2[2][-120:]}')

    ct = clean_tables(3, avoid=(e4_parked_t,))
    mv_u3 = live_player_at(ct[0])
    d0 = deadlocks()
    h1 = bg(w_commit_e4(ct[0], hold=1.0, app='e4_hand_first'))
    wait_until_holding('e4_hand_first', h1)
    h2 = bg(move_sql(mv_u3, ct[0], ct[1], hold=0.0, app='e4_race2'))
    r1, r2 = finish(h1), finish(h2)
    check('after E4: move vs hand on SAME source table (hand-first) serializes on table row, 0 deadlocks',
          deadlocks() == d0 and r1[1] == 0 and r2[1] == 0 and r2[0] >= 0.6,
          f'dl={deadlocks()-d0} move={r2[0]:.2f}s {r1[2][-120:]} {r2[2][-120:]}')

    # 7. Exclusive lifecycle FOR UPDATE on public.tournaments STILL excludes FOR KEY SHARE hand commits
    ct = clean_tables(3, avoid=(e4_parked_t,))
    h_excl = bg(f"SET application_name='e4_excl'; BEGIN; SELECT 1 FROM public.tournaments WHERE id='{TR}' FOR UPDATE; SELECT pg_sleep(1.0); COMMIT;")
    wait_until_holding('e4_excl', h_excl)
    dt_excl, rc_excl, o_excl = timed(w_commit_e4(ct[0]))
    finish(h_excl)
    check('after E4: exclusive FOR UPDATE lifecycle lock STILL blocks FOR KEY SHARE hand commit',
          rc_excl == 0 and dt_excl >= 0.6, f'{dt_excl:.3f}s rc={rc_excl}')

    # 8. Mixed concurrent E4 stress run (0 deadlocks, 100% chip conservation)
    log0 = LOG.read_text().count('deadlock detected')
    e4_outcomes = {'hand': [], 'move': [], 'rebuy': [], 'close': []}
    def e4_worker(kind, jobs):
        for sq in jobs:
            dt, rc, o = timed(sq)
            e4_outcomes[kind].append((rc, round(dt, 3), o[-160:]))
    alive_e4 = [t for t in clean_tables(8, avoid=(e4_parked_t,)) if live_player_at(t) and free_chair(t)][:6]
    e4_reb = [bust_pending_bounty(alive_e4[i % len(alive_e4)])[0] for i in range(4)]
    e4_movers = [live_player_at(t) for t in alive_e4[:4] if live_player_at(t)]
    e4_dest_arr = ','.join(f"'{t}'" for t in alive_e4)
    def e4_rand_move(u):
        return (
            f"DO $mv$ DECLARE v_src uuid; v_dst uuid; v_chair int; BEGIN "
            f"SELECT table_id INTO v_src FROM public.table_seats WHERE user_id='{u}' AND left_at IS NULL; "
            f"SELECT id INTO v_dst FROM public.tables WHERE id = ANY(ARRAY[{e4_dest_arr}]::uuid[]) AND id<>v_src ORDER BY random() LIMIT 1; "
            f"SELECT min(n) INTO v_chair FROM generate_series(1,9) n WHERE NOT EXISTS ("
            f"  SELECT 1 FROM public.table_seats s WHERE s.table_id=v_dst AND s.seat_number=n AND s.left_at IS NULL); "
            f"IF v_src IS NULL OR v_chair IS NULL THEN RETURN; END IF; "
            f"PERFORM public.fn_move_tournament_player('{TR}','{u}',v_src,v_dst,v_chair,gen_random_uuid(),'live_source'); "
            f"END $mv$;"
        )
    e4_ths = (
        [threading.Thread(target=e4_worker, args=('hand', [w_commit_e4(alive_e4[rng.randrange(len(alive_e4))]) for _ in range(25)])) for _ in range(4)]
        + [threading.Thread(target=e4_worker, args=('move', [e4_rand_move(u) for u in e4_movers]))]
        + [threading.Thread(target=e4_worker, args=('rebuy', [rebuy_sql(u, 'pending') for u in e4_reb]))]
        + [threading.Thread(target=e4_worker, args=('close', [close_sql(TR) for _ in range(8)]))]
    )
    [t.start() for t in e4_ths]
    [t.join() for t in e4_ths]
    dl_e4 = LOG.read_text().count('deadlock detected') - log0
    e4_failed = {kk: [x for x in v if x[0] != 0 and not any(t in x[2] for t in taken)] for kk, v in e4_outcomes.items()}
    results['e4_after'] = e4_after
    results['e4_mixed'] = {
        'transactions': sum(len(v) for v in e4_outcomes.values()),
        'deadlocks': dl_e4,
        'failures': {kk: len(v) for kk, v in e4_failed.items()},
        'hand_commit_p100_s': max(x[1] for x in e4_outcomes['hand']),
    }
    check('E4 mixed run: 0 deadlocks and every transaction committed',
          dl_e4 == 0 and all(not v for v in e4_failed.values()), results['e4_mixed'])
    e2_invariants('after E4: mixed run')

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
