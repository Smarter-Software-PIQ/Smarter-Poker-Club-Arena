"""Source-bound native regression for the read-only leaderboard extrema rewrite."""
import argparse, os, re, subprocess, tempfile
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--pg-bin',default=os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
p.add_argument('--scratch',required=True)
a=p.parse_args()
root=Path(__file__).resolve().parents[2]
candidate=root/'supabase/migrations/20261107084902_leaderboard_snapshot_extrema_stop_at_first_eligible_date.sql'
migration=candidate.read_text()
before=re.search(r'v_old text := \$old\$(.*?)\$old\$;',migration,re.S).group(1)
schema="""
CREATE TABLE profiles(id uuid PRIMARY KEY,status text);
CREATE TABLE club_members(user_id uuid,club_id uuid,joined_at timestamptz);
CREATE TABLE union_clubs(union_id uuid,club_id uuid);
CREATE TABLE player_stats(user_id uuid,club_id uuid,hands_dealt bigint,total_winnings numeric,total_losses numeric,tournaments_won bigint,total_rake numeric,sum_big_blind numeric);
CREATE TABLE player_stats_snapshots(LIKE player_stats INCLUDING ALL,snapshot_date date NOT NULL,visible boolean DEFAULT true);
CREATE INDEX ON player_stats_snapshots(club_id,snapshot_date,user_id);
CREATE VIEW ca_stats_player_stats_snapshots_real AS SELECT * FROM player_stats_snapshots WHERE visible;
CREATE VIEW ca_stats_player_stats_lifetime AS SELECT * FROM player_stats;
CREATE VIEW ca_stats_player_stats_snapshots_lifetime AS SELECT * FROM player_stats_snapshots WHERE visible;
CREATE FUNCTION fn_leaderboard_period_window(text,integer) RETURNS TABLE(start_date date) LANGUAGE sql AS $$ SELECT DATE '2026-11-01' $$;
CREATE FUNCTION fn_ca_stats_home_club(uuid,uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT $2 $$;
INSERT INTO union_clubs VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO club_members VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002',now()),('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002',now());
INSERT INTO player_stats VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',100,100,10,2,5,50),('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001',100,100,10,2,5,50);
INSERT INTO player_stats_snapshots SELECT *,DATE '2026-10-30',true FROM player_stats;
INSERT INTO player_stats_snapshots SELECT user_id,club_id,120,120,20,3,6,60,DATE '2026-11-01',false FROM player_stats;
INSERT INTO player_stats_snapshots SELECT user_id,club_id,90,80,10,1,4,40,current_date-1,true FROM player_stats;
UPDATE player_stats_snapshots SET hands_dealt=40,total_winnings=40 WHERE snapshot_date='2026-10-30';
"""
with tempfile.TemporaryDirectory(prefix='le-',dir=a.scratch) as folder:
    d=Path(folder); socket=d/'s';socket.mkdir();pg=Path(a.pg_bin)
    env=dict(os.environ,PGHOST=str(socket),PGUSER='postgres',PGDATABASE='postgres')
    def run(cmd,sql=None):
        r=subprocess.run([str(x) for x in cmd],input=sql,env=env,text=True,capture_output=True,timeout=60)
        if r.returncode:raise RuntimeError(r.stderr)
        return r.stdout
    run([pg/'initdb','-D',d/'data','-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale'])
    run([pg/'pg_ctl','-D',d/'data','-l',d/'log','-o',f"-h '' -k {socket}",'-w','start'])
    try:
        run([pg/'psql','-X','-v','ON_ERROR_STOP=1'],schema+before)
        setup="""CREATE TABLE expected_security AS SELECT proowner,proacl,proconfig,prosecdef,provolatile FROM pg_proc WHERE oid='fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure; CREATE TABLE expected AS SELECT * FROM fn_club_leaderboard_period_v2('00000000-0000-0000-0000-000000000002','hands_played','weekly',10,0);
DO $$ BEGIN IF (SELECT count(*) FROM expected)<>2 OR EXISTS(SELECT 1 FROM expected WHERE hands_played<>60 OR rank<>1 OR total_ranked<>2) THEN RAISE EXCEPTION 'independent fixture result wrong';END IF;END $$;"""
        run([pg/'psql','-X','-v','ON_ERROR_STOP=1'],setup)
        run([pg/'psql','-X','-v','ON_ERROR_STOP=1'],migration)
        check="""DO $$ BEGIN IF EXISTS(SELECT proowner,proacl,proconfig,prosecdef,provolatile FROM pg_proc WHERE oid='fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure EXCEPT SELECT * FROM expected_security) THEN RAISE EXCEPTION 'security metadata changed'; END IF; END $$; DO $$ BEGIN IF EXISTS((SELECT * FROM expected EXCEPT ALL SELECT * FROM fn_club_leaderboard_period_v2('00000000-0000-0000-0000-000000000002','hands_played','weekly',10,0)) UNION ALL (SELECT * FROM fn_club_leaderboard_period_v2('00000000-0000-0000-0000-000000000002','hands_played','weekly',10,0) EXCEPT ALL SELECT * FROM expected)) THEN RAISE EXCEPTION 'rank or measure changed'; END IF; END $$;
TRUNCATE player_stats_snapshots;
DO $$ BEGIN IF (SELECT count(*) FROM fn_club_leaderboard_period_v2('00000000-0000-0000-0000-000000000002','profit','weekly',10,0))<>2 THEN RAISE EXCEPTION 'empty snapshot history lost active players';END IF;END $$;
INSERT INTO player_stats_snapshots SELECT *,DATE '2026-11-02',true FROM player_stats;
DO $$ BEGIN IF (SELECT count(*) FROM fn_club_leaderboard_period_v2('00000000-0000-0000-0000-000000000002','hands_played','weekly',10,0))<>0 THEN RAISE EXCEPTION 'future first-snapshot fallback changed';END IF;END $$;
DO $$ BEGIN IF (SELECT count(*) FROM fn_club_leaderboard_period_v2('00000000-0000-0000-0000-000000000001','hands_played','all_time',10,0))<>2 THEN RAISE EXCEPTION 'All Time standalone path changed';END IF;END $$;
"""
        run([pg/'psql','-X','-v','ON_ERROR_STOP=1'],check)
        print('PASS native exact migration: filtered latest, sparse baseline, tied ranks, previous rank, empty snapshots; no production installation')
    finally:run([pg/'pg_ctl','-D',d/'data','-m','immediate','-w','stop'])
