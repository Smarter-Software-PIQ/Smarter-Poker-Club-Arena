#!/usr/bin/env python3
"""Native PostgreSQL proof: a busted player's stale table is not break custody.

Migration 20261125020712. Production 2026-11-25: a rebuy (or re-entry) of a
player who had busted on a table that was then broken was refused with
F06_SOURCE_EXCLUDED on every retry for the whole break (2,584 refusals in 24
hours) and lost its decision window. The player's tournament_players.table_id
still named the table they left; smarter_private.f06_source_guard counted that
stale pointer as source custody.

This builds a throwaway cluster on a Unix socket, installs the EXACT live
guard (scripts/ci/fixtures/f06-stale-roster/live-f06-source-guard-20261125.sql,
md5 0b9d60df00b7fb673767534b59bacf51) and the exact live rebuy-lane proof,
with the production triggers, over minimal relations holding only the columns
the guard reads. It then proves:

  BEFORE  the live guard refuses both measured shapes:
          - the seat assignment's roster move off the broken table;
          - the money core reviving the row on it inside the player's rebuy lane.
  AFTER   the unmodified migration file:
          - both measured shapes are admitted;
          - still refused: a live chair on the source, a break member, a break
            attempt, a manifest entry, a destination that is itself a break
            source, a revive on the source outside the rebuy lane, another
            player's rebuy lane, a different user on the row, and every
            table_seats insert/update/delete on the source;
          - an acknowledged break binds nothing, before and after.

No network and no production connection.

Usage: PG_BIN=/usr/lib/postgresql/17/bin python3 scripts/ci/test-a-busted-players-stale-table-is-not-break-custody.py
"""
import hashlib
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / 'scripts/ci/fixtures/f06-stale-roster'
GUARD = FIX / 'live-f06-source-guard-20261125.sql'
LANE = FIX / 'tournament-rebuy-lane-held.sql'
MIGRATION = ROOT / 'supabase/migrations/20261125020712_a_busted_players_stale_table_is_not_break_custody.sql'
PG_BIN = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))

EVENT = '11000000-0000-0000-0000-000000000001'
SRC = '22000000-0000-0000-0000-000000000001'    # table being broken
DST = '22000000-0000-0000-0000-000000000002'    # ordinary destination
DST_BREAKING = '22000000-0000-0000-0000-000000000003'
BREAK = '33000000-0000-0000-0000-000000000001'
BREAK_DST = '33000000-0000-0000-0000-000000000003'
BUSTED = '44000000-0000-0000-0000-000000000001'
OTHER = '44000000-0000-0000-0000-000000000002'

SCHEMA = f"""
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA smarter_private;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_engine_lease_stale_seconds() RETURNS integer LANGUAGE sql AS $$ SELECT 30 $$;
-- The event lane itself is proven elsewhere (tournament-event-lane.yml); here
-- it only has to be taken, never refused.
CREATE FUNCTION smarter_private.f06_try_lane(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
  user_id uuid, table_id uuid, seat_number integer, status text, chips integer, eliminated_at timestamptz);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  seat_number integer, stack numeric, status text, joined_at timestamptz DEFAULT now(), left_at timestamptz, club_id uuid);
CREATE TABLE public.tournament_knockout_candidates(id uuid PRIMARY KEY, tournament_id uuid, table_id uuid,
  eliminated_user_id uuid, state text, stack_after numeric, seat_id uuid, seat_joined_at timestamptz);
CREATE TABLE public.tournament_seat_exit_authorizations(tournament_id uuid, operation text, token uuid);
CREATE TABLE public.engine_tournament_leases(tournament_id uuid, lease_generation uuid, instance_id uuid,
  protocol_version integer, heartbeat_at timestamptz);
CREATE TABLE smarter_private.f06_operations(break_id uuid PRIMARY KEY, tournament_id uuid, source_table_id uuid,
  state text, manifest jsonb, close_receipt jsonb, cleanup_kind text, abort_receipt_id uuid, lifecycle bigint);
CREATE TABLE smarter_private.f06_members(break_id uuid, user_id uuid, source_seat_id uuid, source_seat_number integer, occupancy_id uuid);
CREATE TABLE smarter_private.f06_attempts(request_id uuid, break_id uuid, user_id uuid, destination_table_id uuid, destination_seat_number integer);
CREATE TABLE smarter_private.f06_movement_admissions(admission_id uuid, break_id uuid);
CREATE TABLE smarter_private.f06_dispatch(xid bigint, request_id uuid);
CREATE TABLE smarter_private.f06_hand_permits(permit_id uuid, table_id uuid, hand_number integer, state text,
  tournament_id uuid, generation uuid, lifecycle bigint);
CREATE TABLE smarter_private.f06_hand_dispatch(xid bigint, permit_id uuid);
CREATE TABLE smarter_private.f06_elimination_dispatch(xid bigint, relation_name text, row_id uuid, candidate_id uuid,
  old_record jsonb, new_record jsonb);
CREATE TABLE smarter_private.hand_submissions(submission_id uuid, request_hash text, lease_generation uuid, request jsonb);
CREATE TABLE smarter_private.retirement_original_hand_qualification(submission_id uuid, tournament_id uuid, table_id uuid,
  hand_number integer, request_hash text, expected jsonb);
CREATE TABLE smarter_private.retirement_original_hand_restorations(submission_id uuid, transaction_id bigint,
  request_hash text, qualification_hash text, original_generation uuid, successor_generation uuid, instance_id uuid,
  restored_players integer);
INSERT INTO public.tables VALUES ('{SRC}','{EVENT}'),('{DST}','{EVENT}'),('{DST_BREAKING}','{EVENT}');
"""

TRIGGERS = """
CREATE TRIGGER a00_f06_source_seat BEFORE INSERT OR DELETE OR UPDATE OF table_id, user_id, seat_number, left_at ON public.table_seats FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_source_guard();
CREATE TRIGGER a00_f06_source_roster BEFORE INSERT OR DELETE OR UPDATE OF table_id, user_id, seat_number, status ON public.tournament_players FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_source_guard();
"""

# Every case opens with the measured board: a break in progress on SRC that
# read one live member (OTHER, chair 2); the busted player's chair on SRC is
# already closed with a zero stack and their roster row still names SRC.
BOARD = f"""
SET LOCAL session_replication_role = replica;
INSERT INTO smarter_private.f06_operations(break_id,tournament_id,source_table_id,state,manifest)
  VALUES ('{BREAK}','{EVENT}','{SRC}','begun','[{{"user_id":"{OTHER}","source_seat_number":2}}]');
INSERT INTO smarter_private.f06_members(break_id,user_id,source_seat_number) VALUES ('{BREAK}','{OTHER}',2);
INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status,left_at)
  VALUES ('{SRC}','{BUSTED}',4,0,'left',now()), ('{SRC}','{OTHER}',2,5000,'active',NULL);
INSERT INTO public.tournament_players(tournament_id,user_id,table_id,seat_number,status,chips)
  VALUES ('{EVENT}','{BUSTED}','{SRC}',4,'playing',0), ('{EVENT}','{OTHER}','{SRC}',2,'playing',5000);
SET LOCAL session_replication_role = origin;
"""

def rebuy_lane(user):
    return (f"SELECT set_config('ca.tournament_rebuy_lane','{EVENT}:{user}:'||txid_current(),true),"
            f"pg_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1:{EVENT}',0)),"
            f"pg_advisory_xact_lock(hashtextextended('ca:tournament-rebuy-lane:v1:{EVENT}',0));")

MOVE_OFF = f"UPDATE public.tournament_players SET table_id='{DST}',seat_number=5,status='playing',chips=4000 WHERE user_id='{BUSTED}';"
REVIVE = f"UPDATE public.tournament_players SET status='playing',chips=4000,eliminated_at=NULL WHERE user_id='{BUSTED}';"
ELIMINATED = (f"SET LOCAL session_replication_role = replica; UPDATE public.tournament_players SET status='eliminated',"
              f"eliminated_at=now() WHERE user_id='{BUSTED}'; SET LOCAL session_replication_role = origin;")

# name -> (setup, statement, refused before, refused after)
CASES = {
    'assignment moves a busted roster row off the broken table':
        ('', MOVE_OFF, True, False),
    'money core revives the busted row inside its own rebuy lane':
        (ELIMINATED + rebuy_lane(BUSTED), REVIVE, True, False),
    'a pending bust (still playing) is moved off by the assignment':
        (rebuy_lane(BUSTED), MOVE_OFF, True, False),
    'revive on the source outside any rebuy lane':
        (ELIMINATED, REVIVE, True, True),
    "revive inside another player's rebuy lane":
        (ELIMINATED + rebuy_lane(OTHER), REVIVE, True, True),
    'busted player still holds a live chair on the source':
        (f"SET LOCAL session_replication_role = replica; UPDATE public.table_seats SET left_at=NULL,status='active' WHERE user_id='{BUSTED}'; SET LOCAL session_replication_role = origin;",
         MOVE_OFF, True, True),
    'busted player is a break member':
        (f"INSERT INTO smarter_private.f06_members(break_id,user_id,source_seat_number) VALUES ('{BREAK}','{BUSTED}',4);", MOVE_OFF, True, True),
    'busted player has a break attempt':
        (f"INSERT INTO smarter_private.f06_attempts(request_id,break_id,user_id,destination_table_id,destination_seat_number) VALUES (gen_random_uuid(),'{BREAK}','{BUSTED}','{DST}',5);", MOVE_OFF, True, True),
    'busted player is in the manifest':
        (f"UPDATE smarter_private.f06_operations SET manifest=manifest||'[{{\"user_id\":\"{BUSTED}\"}}]'::jsonb WHERE break_id='{BREAK}';", MOVE_OFF, True, True),
    'destination is itself a break source':
        (f"INSERT INTO smarter_private.f06_operations(break_id,tournament_id,source_table_id,state) VALUES ('{BREAK_DST}','{EVENT}','{DST_BREAKING}','begun');",
         f"UPDATE public.tournament_players SET table_id='{DST_BREAKING}',seat_number=5 WHERE user_id='{BUSTED}';", True, True),
    'a member leaves the source without the break dispatching it':
        ('', f"UPDATE public.tournament_players SET table_id='{DST}',seat_number=6 WHERE user_id='{OTHER}';", True, True),
    'the roster row is handed to a different user':
        ('', f"UPDATE public.tournament_players SET user_id='{OTHER}',table_id='{DST}' WHERE user_id='{BUSTED}';", True, True),
    'a chair is inserted on the source':
        (rebuy_lane(BUSTED), f"INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,status) VALUES ('{SRC}','{BUSTED}',7,4000,'active');", True, True),
    "the busted player's closed chair is reopened on the source":
        (rebuy_lane(BUSTED), f"UPDATE public.table_seats SET left_at=NULL,status='active',stack=4000 WHERE user_id='{BUSTED}';", True, True),
    'a chair on the source is deleted':
        ('', f"DELETE FROM public.table_seats WHERE user_id='{BUSTED}';", True, True),
    'an acknowledged break binds nothing':
        (f"UPDATE smarter_private.f06_operations SET state='acknowledged' WHERE break_id='{BREAK}';", MOVE_OFF, False, False),
}


class Cluster:
    def __init__(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix='f06-stale-roster-'))
        self.data = self.dir / 'data'
        self.sock = self.dir / 'sock'
        self.sock.mkdir()

    def start(self):
        subprocess.run([str(PG_BIN / 'initdb'), '-D', str(self.data), '-A', 'trust', '-U', 'postgres',
                        '--no-sync', '-E', 'UTF8'], check=True, capture_output=True)
        subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(self.data), '-w', '-l', str(self.dir / 'log'),
                        '-o', f"-k {self.sock} -c listen_addresses='' -c fsync=off", 'start'],
                       check=True, capture_output=True)

    def stop(self):
        subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(self.data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(self.dir, ignore_errors=True)

    def psql(self, sql, db='postgres'):
        return subprocess.run([str(PG_BIN / 'psql'), '-h', str(self.sock), '-U', 'postgres', '-d', db,
                               '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At'],
                              input=sql, capture_output=True, text=True)


def run_case(c, db, setup, statement):
    r = c.psql('BEGIN;' + BOARD + setup + statement + 'ROLLBACK;', db)
    if r.returncode == 0:
        return False
    if 'F06_SOURCE_EXCLUDED' in r.stderr:
        return True
    raise RuntimeError('unexpected failure (not the guard): ' + r.stderr.strip())


def main():
    guard = GUARD.read_text()
    if hashlib.md5(guard.encode()).hexdigest() != '0b9d60df00b7fb673767534b59bacf51':
        sys.exit('pinned live guard fixture changed')
    if hashlib.md5(LANE.read_text().encode()).hexdigest() != 'd32dad9b538f214bdeb224e1596d5416':
        sys.exit('pinned rebuy-lane proof fixture changed')
    c = Cluster()
    failures = []
    try:
        c.start()
        r = c.psql('CREATE DATABASE proof;')
        if r.returncode:
            sys.exit(r.stderr)
        r = c.psql(SCHEMA + LANE.read_text() + ';' + guard + ';' + TRIGGERS, 'proof')
        if r.returncode:
            sys.exit('install failed: ' + r.stderr)
        live = c.psql("SELECT md5(pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure));", 'proof').stdout.strip()
        if live != '0b9d60df00b7fb673767534b59bacf51':
            sys.exit('installed guard does not reproduce the live md5: ' + live)
        for phase, column in (('before', 2), ('after', 3)):
            if phase == 'after':
                r = c.psql(MIGRATION.read_text(), 'proof')
                if r.returncode:
                    sys.exit('migration failed: ' + r.stderr)
                post = c.psql("SELECT md5(pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure));", 'proof').stdout.strip()
                if post != '4acd120a2a9bcf4535bdd189ef3ae2f9':
                    sys.exit('migration did not land on its post-image: ' + post)
                again = c.psql(MIGRATION.read_text(), 'proof')
                if again.returncode == 0 or 'not the pinned pre-image' not in again.stderr:
                    sys.exit('a second run must refuse on the pre-image pin: ' + again.stderr)
            for name, case in CASES.items():
                setup, statement = case[0], case[1]
                expected = case[column]
                refused = run_case(c, 'proof', setup, statement)
                ok = refused == expected
                print(f"{'PASS' if ok else 'FAIL'} {phase:6} {'refused ' if refused else 'admitted'} {name}")
                if not ok:
                    failures.append((phase, name))
    finally:
        c.stop()
    if failures:
        sys.exit(f'{len(failures)} case(s) failed: {failures}')
    print(f'all {2 * len(CASES)} checks passed')


if __name__ == '__main__':
    main()
