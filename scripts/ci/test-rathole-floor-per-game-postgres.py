#!/usr/bin/env python3
"""A rathole floor belongs to one cash game, proved on real isolated PostgreSQL.

Dan, 2026-11-18: a stack won in one cash game (PLO5 1/2 Classic, the game
named "PLO5 1/2 Madness") may never be carried into another cash game at the
same variant and stakes (PLO5 1/2 Lightning Games). "CLASSIC AND LIGHTNING
ARE TREATED AS SPERATE GAMES EVEN IF THEY ARE THE SAME GAME AND STAKES."

Loads the exact migration production runs
(20261118071741_rathole_floor_is_per_game_not_per_stakes.sql) onto a minimal
schema and executes the cash-out writer and every reader. No production
connection, no production writes.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261118071741_rathole_floor_is_per_game_not_per_stakes.sql'
pg = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
cluster = Path(tempfile.mkdtemp(prefix='rathole-per-game-'))
socket = cluster / 's'
socket.mkdir()


def run(command):
    r = subprocess.run([str(x) for x in command], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout


psql = [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', 'postgres', '-d', 'postgres']


def query(sql):
    f = cluster / 'query.sql'
    f.write_text(sql)
    return run(psql + ['-f', f])


SCHEMA = '''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tables(
  id uuid PRIMARY KEY, club_id uuid, game_variant text, small_blind numeric, big_blind numeric,
  tournament_id uuid, cluster_id uuid, seat_game_scope text, min_buy_in numeric, max_buy_in numeric);
CREATE TABLE public.cash_player_session(
  id uuid DEFAULT gen_random_uuid(), player_id uuid, scope_type text, scope_id uuid,
  closed_at timestamptz, closed_reason text, final_stack numeric,
  final_stack_captured_at timestamptz, financial_capture_status text, close_table_id uuid);
CREATE TABLE public.cash_rejoin_constraints(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, club_id uuid, variant text,
  sb numeric, bb numeric, required_stack numeric CHECK (required_stack > 0), left_at timestamptz,
  expires_at timestamptz, source_table_id uuid, barred_until timestamptz);
CREATE FUNCTION public.test_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assert: %', label; END IF; END $$;
'''

# Club c, PLO5 1/2 everywhere. Classic game a1 (feeder + main), Lightning game
# b1 (feeder), a standalone PLO5 1/2 table s1, and the same Classic game at
# 2/5 (a2) for contrast.
FIXTURE = '''
INSERT INTO public.tables VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c','plo5',1,2,NULL,'00000000-0000-0000-0000-00000000c1a5','cluster:00000000-0000-0000-0000-00000000c1a5',100,400),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000000c','plo5',1,2,NULL,'00000000-0000-0000-0000-00000000c1a5','cluster:00000000-0000-0000-0000-00000000c1a5',100,400),
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000c','plo5',1,2,NULL,'00000000-0000-0000-0000-0000000011f7','cluster:00000000-0000-0000-0000-0000000011f7',100,400),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000c','plo5',1,2,NULL,NULL,NULL,100,400),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-00000000000c','plo5',1,2,NULL,NULL,'table:00000000-0000-0000-0000-0000000000e2',100,400);
-- A pre-migration row (no game_scope column yet) earned at the Classic feeder.
INSERT INTO public.cash_rejoin_constraints(player_id,club_id,variant,sb,bb,required_stack,left_at,expires_at,source_table_id)
VALUES ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-00000000000c','plo5',1,2,999,now(),now()+interval '2 hours','00000000-0000-0000-0000-0000000000a1');
'''

CLASSIC_FEEDER = "'00000000-0000-0000-0000-0000000000a1'"
CLASSIC_MAIN = "'00000000-0000-0000-0000-0000000000a2'"
LIGHTNING = "'00000000-0000-0000-0000-0000000000b1'"
SOLO_A = "'00000000-0000-0000-0000-0000000000e1'"
SOLO_B = "'00000000-0000-0000-0000-0000000000e2'"
WOOWOO = "'00000000-0000-0000-0000-000000000222'"
OLD = "'00000000-0000-0000-0000-000000000111'"
HORSE = "'00000000-0000-0000-0000-000000000333'"

ASSERTIONS = f'''
-- The backfill scoped the pre-migration row to the game it was earned in.
SELECT test_assert((SELECT game_scope FROM cash_rejoin_constraints WHERE player_id={OLD})
  = 'cluster:00000000-0000-0000-0000-00000000c1a5', 'backfill scopes old rows to their game');
SELECT test_assert(fn_cash_rejoin_floor({OLD},{LIGHTNING}) IS NULL, 'old Classic floor does not reach Lightning');
SELECT test_assert(fn_cash_rejoin_floor({OLD},{CLASSIC_MAIN}) = 999, 'old Classic floor still holds in Classic');

-- WooWoo leaves the Classic feeder ahead with 3,762.18.
SELECT fn_cash_session_close({WOOWOO},{CLASSIC_FEEDER},3762.18,'voluntary');
SELECT test_assert((SELECT game_scope FROM cash_rejoin_constraints WHERE player_id={WOOWOO})
  = 'cluster:00000000-0000-0000-0000-00000000c1a5', 'the writer scopes the floor to the game');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{CLASSIC_FEEDER}) = 3762.18, 'rathole holds at the same table');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{CLASSIC_MAIN}) = 3762.18, 'rathole holds across the same game');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{LIGHTNING}) IS NULL, 'Classic stack never reaches Lightning, same variant and stakes');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{SOLO_A}) IS NULL, 'Classic stack never reaches a standalone table');

-- Leaving Lightning writes a Lightning floor; it never raises the Classic floor.
SELECT fn_cash_session_close({WOOWOO},{LIGHTNING},5000,'voluntary');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{LIGHTNING}) = 5000, 'Lightning floor holds in Lightning');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{CLASSIC_MAIN}) = 3762.18, 'Lightning floor never reaches Classic');
SELECT test_assert((SELECT count(*) FROM cash_rejoin_constraints WHERE player_id={WOOWOO}) = 2, 'one row per game');

-- Two standalone tables at the same stakes are two games.
SELECT fn_cash_session_close({WOOWOO},{SOLO_A},700,'voluntary');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{SOLO_A}) = 700, 'standalone floor holds at its own table');
SELECT test_assert(fn_cash_rejoin_floor({WOOWOO},{SOLO_B}) IS NULL, 'standalone floor never reaches another standalone table');

-- A low-VPIP bar is for that game only.
SELECT fn_cash_session_close({HORSE},{CLASSIC_FEEDER},0,'vpip_evicted');
DO $$ BEGIN
  BEGIN
    PERFORM fn_cash_rejoin_floor({HORSE},{CLASSIC_MAIN});
    RAISE EXCEPTION 'assert: VPIP bar must refuse the same game';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'VPIP_BARRED:%' THEN RAISE; END IF;
  END;
END $$;
SELECT test_assert(fn_cash_rejoin_floor({HORSE},{LIGHTNING}) IS NULL, 'VPIP bar never reaches Lightning');
SELECT test_assert(fn_cash_game_barred_seconds('00000000-0000-0000-0000-00000000c1a5',{HORSE}) > 0, 'lobby timer shows the bar in its game');
SELECT test_assert(fn_cash_game_barred_seconds('00000000-0000-0000-0000-0000000011f7',{HORSE}) IS NULL, 'lobby timer shows nothing in another game');

-- Grants: no anonymous caller reaches any of these.
SELECT test_assert(NOT has_function_privilege('anon','public.fn_cash_rejoin_floor(uuid,uuid)','EXECUTE'), 'anon cannot read floors');
SELECT test_assert(NOT has_function_privilege('authenticated','public.fn_cash_session_close(uuid,uuid,numeric,text)','EXECUTE'), 'browsers cannot write floors');
SELECT test_assert(NOT has_function_privilege('authenticated','public.fn_cash_game_scope_of_table(uuid)','EXECUTE'), 'scope helper is not browser-reachable');
'''

try:
    shared = Path(run([pg / 'pg_config', '--sharedir']).strip())
    run([pg / 'initdb', '-L', shared, '-D', cluster / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'server.log', '-o', f"-h '' -k {socket}", '-w', 'start'])
    query(SCHEMA)
    query(FIXTURE)
    query(MIGRATION.read_text())
    query(ASSERTIONS)
    print('rathole floor per game: every assertion held on native PostgreSQL')
finally:
    subprocess.run([str(pg / 'pg_ctl'), '-D', str(cluster / 'data'), '-m', 'immediate', 'stop'], capture_output=True)
