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
MIG_T1 = ROOT / 'supabase/migrations/20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql'
MIG_T2 = ROOT / 'supabase/migrations/20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql'
FIX = ROOT / 'scripts/ci/fixtures/rebuy-never-pauses/preimages.json'
FIX_T = ROOT / 'scripts/ci/fixtures/tournament-lane-isolation/preimages.json'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/rebuy-never-pauses')
parser.add_argument('--print-post-images', action='store_true')
args = parser.parse_args()
for p in (MIG, MIG_T1, MIG_T2, FIX, FIX_T):
    if not p.exists():
        sys.exit(f'missing {p.relative_to(ROOT)} (lane T, PR #11310, must be in this tree)')
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)

migration = MIG.read_text()
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
  table_id uuid, seat_id uuid, seat_joined_at timestamptz, resolved_at timestamptz, stack_after numeric);
CREATE TABLE public.entry_purchase_idempotency_receipts(key_domain text, idempotency_key text, request jsonb,
  response jsonb, PRIMARY KEY (key_domain, idempotency_key));
CREATE TABLE public.wallet_credit_idempotency(key text PRIMARY KEY, user_id uuid, amount numeric);
CREATE TABLE public.ca_operator_floor_hold(operation_id uuid, mode text);
CREATE TABLE public.ca_launch_operator_scopes(operation_id uuid, club_ids uuid[]);
CREATE TABLE public.tournament_obligations(tournament_id uuid, user_id uuid, kind text, amount_paid numeric,
  amount_owed numeric, settled_at timestamptz);
CREATE TABLE public.tournament_bounty_obligations(id uuid, tournament_id uuid, eliminated_user_id uuid,
  hand_number int, hand_id uuid, state text);
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
CREATE TABLE public.tournament_seat_exit_authorizations(tournament_id uuid, operation text, token uuid);
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
            f"  AND tp.tournament_id='{TR}' AND tp.chips IS DISTINCT FROM s.stack::int; "
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
 'pool', (SELECT prize_pool FROM public.tournaments WHERE id='{TR}'),
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
          and r['ledger'] == r['pool'] == r['rebuys'] * 10 and r['dup_chairs'] == 0
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


def subs_post_images(db):
    """The migration's substitutions applied to the live pre-images (print mode)."""
    blk = re.search(r'DO \$subs\$(.*?)END \$subs\$;', migration, re.S).group(1)
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


try:
    subprocess.run(as_owner + [str(pg / 'initdb'), '-D', str(cluster / 'data'), '-U', 'postgres', '-A', 'trust',
                               '--no-locale'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-l', str(LOG), '-o',
                   f"-k {sock} -p {PORT} -c listen_addresses='' -c log_lock_waits=on -c deadlock_timeout=200ms "
                   "-c max_connections=80", '-w', 'start'], check=True, capture_output=True, env=env)
    subprocess.run(as_owner + [str(pg / 'createdb'), '-h', str(sock), '-p', PORT, '-U', 'postgres', 'w'],
                   check=True, env=env)

    if args.print_post_images:
        install('w')
        psql(MIG_T1.read_text())
        psql(mig_t2_native)
        for sig, h in subs_post_images('w').items():
            print(sig, h)
        news = re.findall(r'^(CREATE FUNCTION .*?\$function\$;)', migration, re.S | re.M)
        psql('\n'.join(news))
        for sig in ('smarter_private.tournament_rebuy_lane_held(uuid,uuid)',
                    'public.fn_ca_share_tournament_lane_for_rebuy(uuid,uuid)',
                    'public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'):
            print(sig, q(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))"))
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
    final = invariants('after: mixed run')
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
