#!/usr/bin/env python3
"""Execute the maintained self-only aggregate on isolated PG17, never production."""
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261101030330_full_game_session_hand_statistics.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin' if sys.platform == 'darwin' else '/usr/lib/postgresql/17/bin'))
def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'

def main():
    if sys.platform == 'darwin':
        assert str(ROOT).startswith('/Volumes/SmarterWork/agent-work/')
    scratch = ROOT.parent if sys.platform == 'darwin' else os.environ.get('RUNNER_TEMP')
    env = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C'}
    with tempfile.TemporaryDirectory(prefix='hands-', dir=scratch) as folder:
        base = Path(folder)
        data, sock = base / 'd', ROOT.parent / 's' if sys.platform == 'darwin' else base / 's'
        sock.mkdir()
        subprocess.run([str(PG/'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, env=env, stdout=subprocess.DEVNULL)
        subprocess.run([str(PG/'pg_ctl'), '-D', str(data), '-l', str(base/'pg.log'), '-o', f"-k {sock} -p 54876 -c listen_addresses=''", 'start'], check=True, env=env, stdout=subprocess.DEVNULL)
        try:
            def run(sql, ok=True):
                r = subprocess.run([str(PG/'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', '54876', '-d', 'postgres'], input=sql, text=True, capture_output=True, env=env)
                assert (r.returncode == 0) == ok, r.stderr
                return r.stdout.strip()
            def stats(table, user=1, role='authenticated'):
                r=run(f"SET ROLE {role}; SET request.jwt.claim.sub='{uid(user)}'; SELECT fn_my_game_session_hand_stats('{uid(table)}');")
                return json.loads(r.splitlines()[-1]) if r else None
            run('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE tables(id uuid PRIMARY KEY,tournament_id uuid);
CREATE TABLE tournaments(id uuid PRIMARY KEY,started_at timestamptz,ended_at timestamptz);
CREATE TABLE tournament_players(user_id uuid,tournament_id uuid,registered_at timestamptz,eliminated_at timestamptz);
CREATE TABLE cash_player_session(player_id uuid,scope_type text,scope_id uuid,opened_at timestamptz,closed_at timestamptz);
CREATE TABLE poker_diamond_custody(user_id uuid,purpose text,target_id uuid,created_at timestamptz,released_at timestamptz);
CREATE TABLE table_seats(table_id uuid,user_id uuid,occupancy_id uuid,joined_at timestamptz,left_at timestamptz);
CREATE TABLE cash_seat_move_receipts(player_id uuid,from_table_id uuid,to_table_id uuid,source_occupancy_id uuid,destination_occupancy_id uuid,created_at timestamptz);
CREATE TABLE ca_hand_facts(hand_id uuid,user_id uuid,table_id uuid,tournament_id uuid,played_at timestamptz,returned numeric,vpip boolean,pfr boolean,PRIMARY KEY(hand_id,user_id));
CREATE TABLE hand_history(id uuid PRIMARY KEY,table_id uuid,created_at timestamptz,players jsonb);
''')
            run(MIGRATION.read_text())
            run(f"INSERT INTO tournaments VALUES('{uid(20)}','2026-10-31 00:00Z',null); INSERT INTO tables VALUES('{uid(10)}','{uid(20)}'),('{uid(11)}','{uid(20)}'),('{uid(12)}',null),('{uid(13)}',null),('{uid(14)}',null); INSERT INTO tournament_players VALUES('{uid(1)}','{uid(20)}','2026-10-30 00:00Z',null);")
            run(f"INSERT INTO ca_hand_facts SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'{uid(1)}',CASE WHEN i<600 THEN '{uid(10)}'::uuid ELSE '{uid(11)}'::uuid END,'{uid(20)}','2026-10-31 00:00Z'::timestamptz+i*interval '1 second',CASE WHEN i%2=0 THEN 1 ELSE 0 END,i%3=0,i%5=0 FROM generate_series(1,1205)i; INSERT INTO hand_history SELECT hand_id,table_id,played_at,jsonb_build_array(jsonb_build_object('userId',user_id)) FROM ca_hand_facts;")
            a=stats(10); b=stats(11)
            assert {k:v for k,v in a.items() if k!='through_at'}=={k:v for k,v in b.items() if k!='through_at'} and a['hands_played']==1205 and a['vpip_percent']==33.3 and a['pfr_percent']==20.0, (a,b)
            assert a['hands_won']==602 and a['facts_complete']
            assert datetime.fromisoformat(a['started_at']).astimezone(timezone.utc).isoformat()=='2026-10-31T00:00:00+00:00', a
            assert stats(10,user=2) is None
            run(f"SET ROLE anon; SELECT fn_my_game_session_hand_stats('{uid(10)}');",False)
            # A history-only hand remains counted, but missing action facts cannot invent percentages.
            run(f"INSERT INTO hand_history VALUES('{uid(9999)}','{uid(11)}','2026-10-31 02:00Z','[{{\"userId\":\"{uid(1)}\"}}]');")
            missing=stats(10); assert missing['hands_played']==1206 and missing['vpip_percent'] is None and missing['hands_won'] is None
            # Whole cash sitting survives A -> B -> A, with old source seat rows already gone.
            run(f"INSERT INTO cash_player_session VALUES('{uid(1)}','table','{uid(12)}','2026-10-30 00:00Z','2026-10-30 03:00Z'); INSERT INTO table_seats VALUES('{uid(12)}','{uid(1)}','{uid(102)}','2026-10-30 00:00Z','2026-10-30 03:00Z'); INSERT INTO cash_seat_move_receipts VALUES('{uid(1)}','{uid(12)}','{uid(13)}','{uid(100)}','{uid(101)}','2026-10-30 01:00Z'),('{uid(1)}','{uid(13)}','{uid(12)}','{uid(101)}','{uid(102)}','2026-10-30 02:00Z');")
            def hand(n,table,time):
                run(f"INSERT INTO ca_hand_facts VALUES('{uid(n)}','{uid(1)}','{uid(table)}',null,'{time}',1,true,false); INSERT INTO hand_history VALUES('{uid(n)}','{uid(table)}','{time}','[{{\"userId\":\"{uid(1)}\"}}]');")
            hand(200,12,'2026-10-30 00:30Z'); hand(201,13,'2026-10-30 01:30Z'); hand(202,12,'2026-10-30 02:59Z')
            hand(203,12,'2026-10-29 23:59Z'); hand(204,13,'2026-10-30 02:30Z'); hand(205,14,'2026-10-30 02:30Z'); hand(206,12,'2026-10-30 03:01Z')
            cash=stats(12); assert cash['hands_played']==3 and cash['vpip_percent']==100 and cash['pfr_percent']==0, cash
            assert stats(12)==cash # duplicate reads never increment
            # New sitting at the same table starts at its own durable boundary.
            run(f"INSERT INTO cash_player_session VALUES('{uid(1)}','table','{uid(12)}','2026-10-30 03:00Z',null); INSERT INTO table_seats VALUES('{uid(12)}','{uid(1)}','{uid(103)}','2026-10-30 03:00Z',null);")
            assert stats(12)['hands_played']==1
            bound=run(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}'; SELECT fn_my_game_session_hand_stats('{uid(12)}','2026-10-30 02:59:30Z');")
            assert json.loads(bound)['hands_played']==3
            # Diamond custody supplies the boundary when no chip cash session exists.
            run(f"INSERT INTO poker_diamond_custody VALUES('{uid(1)}','cash_seat','{uid(14)}','2026-10-30 02:00Z','2026-10-30 03:00Z');")
            assert stats(14)['hands_played']==1
            print('FULL_SESSION_HANDS_PG_PASS: 1205 hands, tournament moves, cash return moves, final hand, new sitting, custody, coverage, isolation, anonymous refusal and replay.')
        finally:
            subprocess.run([str(PG/'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], env=env, stdout=subprocess.DEVNULL, check=True)
            sock.rmdir()
if __name__ == '__main__':
    main()
