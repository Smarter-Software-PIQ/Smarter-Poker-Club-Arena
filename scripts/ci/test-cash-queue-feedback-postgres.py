#!/usr/bin/env python3
"""Execute the maintained queue reader on isolated PostgreSQL, with controlled wallet authority."""
import json, os, re, socket, subprocess, tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[2]
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
with tempfile.TemporaryDirectory(prefix='queue-',dir=os.environ['TMPDIR']) as tmp:
    folder=Path(tmp)
    def run(args,sql=None):
        p=subprocess.run([str(a) for a in args],input=sql,text=True,capture_output=True,timeout=45)
        if p.returncode: raise RuntimeError(p.stdout+p.stderr)
        return p.stdout.strip()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    run([PG/'initdb','-D',folder/'data','-U','postgres','-A','trust','--no-locale'])
    run([PG/'pg_ctl','-D',folder/'data','-l',folder/'postgres.log','-o',f"-h 127.0.0.1 -p {port} -k ''",'-w','start'])
    def q(sql):return run([PG/'psql','-XqAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres'],sql)
    game='11111111-1111-4111-8111-111111111111';user='22222222-2222-4222-8222-222222222222';table='33333333-3333-4333-8333-333333333333';other='44444444-4444-4444-8444-444444444444'
    try:
        q('''CREATE SCHEMA auth;
CREATE ROLE authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
CREATE TABLE waitlist_policy(id boolean,max_concurrent_holds integer);
INSERT INTO waitlist_policy VALUES(true,1);
CREATE TABLE cash_games(id uuid,enabled boolean,closed_at timestamptz,opening_hold_since timestamptz);
CREATE TABLE tables(id uuid,cluster_id uuid,lifecycle text,status text,is_deleted boolean);
CREATE TABLE cash_game_waitlist(id uuid DEFAULT gen_random_uuid(),game_id uuid,user_id uuid,status text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX one_live_entry ON cash_game_waitlist(game_id,user_id) WHERE status IN ('waiting','notified');
CREATE TABLE table_waitlist(id uuid,user_id uuid,table_id uuid,status text,notified_at timestamptz,hold_expires_at timestamptz);
CREATE FUNCTION fn_ca_cash_entry_need(uuid,uuid) RETURNS numeric LANGUAGE sql STABLE AS $$SELECT 40::numeric$$;
CREATE FUNCTION fn_ca_cash_wallet_covers(uuid,uuid,uuid,numeric) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.funded',true),'true')::boolean$$;
CREATE FUNCTION fn_cash_game_open_seats(uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('test.open',true),''),'0')::integer$$;
CREATE FUNCTION fn_cash_game_barred_seconds(uuid,uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.barred',true),'')::integer$$;
''')
        # Exact production predecessor fragment qualifies the migration's guarded lobby rewrite too.
        q("""CREATE FUNCTION fn_cash_game_lobby(p_game_id uuid) RETURNS jsonb LANGUAGE sql AS $old$
SELECT jsonb_build_object('waiting', (SELECT count(*) FROM public.cash_game_waitlist w
                                                WHERE w.game_id = g.id AND w.status IN ('waiting', 'notified')))
FROM cash_games g WHERE g.id=p_game_id;
$old$;""")
        migration=ROOT/'supabase/migrations/20261106040409_cash_queue_explains_admission_eligibility.sql'
        predecessor=(ROOT/'supabase/migrations/20260905053000_join_game_seats_you_at_the_right_table_or_holds_your_place.sql').read_text()
        prior=re.search(r'CREATE OR REPLACE FUNCTION public\.fn_cash_game_waitlist_position[\s\S]*?\$\$;',predecessor).group(0)
        q(prior)
        # Execute the exact original queue tail in isolation. Admission's earlier
        # funding/membership/seat paths are unchanged and intentionally not faked.
        join_source=(ROOT/'supabase/migrations/20261023094000_a_lapsed_game_seat_offer_leaves_the_waitlist.sql').read_text()
        join_tail=join_source.split('  -- Nothing open anywhere: hold the place. One live row per game per player.',1)[1].split('END;',1)[0]
        q("CREATE FUNCTION public.fn_cash_game_join(p_game_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $old$ DECLARE v_uid uuid:=auth.uid(); g record; v_position integer; v_count integer; BEGIN IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF; SELECT * INTO g FROM cash_games WHERE id=p_game_id;\n  -- Nothing open anywhere: hold the place. One live row per game per player."+join_tail+"END; $old$;")

        q(f"INSERT INTO cash_games(id,enabled,closed_at) VALUES('{game}',true,NULL); INSERT INTO tables VALUES('{table}','{game}','live','running',false); INSERT INTO cash_game_waitlist(id,game_id,user_id,status,created_at) VALUES('{user}','{game}','{user}','waiting',now()),('{other}','{game}','{other}','waiting',now()-interval '25 hours');")
        def read(extra='',uid=user):
            return json.loads(q(f"SET test.uid='{uid}'; SET test.funded='true'; SET test.open='0'; SET test.barred=''; {extra} SELECT fn_cash_game_waitlist_position('{game}');"))
        # The exact former reader calls a 25-hour-old entry active. The corrected
        # source below must reverse that result without mutating the row.
        assert read(uid=other)['on_list'] is True
        assert json.loads(q(f"SET test.uid='{other}'; SELECT fn_cash_game_join('{game}');"))['action']=='waitlisted'
        assert q(f"SELECT count(*) FROM cash_game_waitlist WHERE user_id='{other}' AND created_at<now()-interval '24 hours' AND status='waiting'")=='1', 'Former Join falsely retained the aged entry'

        q(migration.read_text())
        assert read()['reason']=='waiting_for_seat'
        assert read()['waiting']==1 and read()['position']==1
        q(f"UPDATE cash_game_waitlist SET created_at=(SELECT created_at FROM cash_game_waitlist WHERE user_id='{user}') WHERE user_id='{other}';")
        assert read()['position']==1 and read(uid=other)['position']==2, 'Equal timestamps keep deterministic FIFO order'
        q(f"UPDATE cash_game_waitlist SET created_at=now()-interval '25 hours' WHERE user_id='{other}';")
        assert read("SET test.funded='false';")['reason']=='insufficient_funds'
        assert read("SET test.open='2';")['reason']=='seat_available'
        assert read("SET test.barred='60';")['reason']=='barred'
        assert read(uid=other)['reason']=='expired' and read(uid=other)['on_list'] is False and read(uid=other)['position'] is None
        assert read(uid='')['reason']=='signed_out'
        q(f"INSERT INTO table_waitlist VALUES('{other}','{user}','{other}','notified',now(),now()+interval '1 minute');")
        assert read("SET test.open='2';")['reason']=='offer_limit'
        q(f"DELETE FROM table_waitlist WHERE id='{other}';")
        assert q(f"SELECT fn_cash_game_lobby('{game}')->>'waiting'")=='1'
        q(f"INSERT INTO table_waitlist VALUES('{user}','{user}','{table}','notified',now(),now()+interval '1 minute'); UPDATE cash_game_waitlist SET status='notified' WHERE user_id='{user}';")
        assert read()['reason']=='seat_reserved' and read()['reserved_table_id']==table
        assert read(uid=other)['reserved_table_id'] is None, 'Never disclose another player hold'
        q(f"UPDATE table_waitlist SET hold_expires_at=now()-interval '1 second';")
        assert read()['reason']=='expired' and read()['waiting']==0
        q(f"UPDATE table_waitlist SET hold_expires_at=now()+interval '6 minutes';")
        assert read()['reason']=='seat_reserved', 'Maintenance thaw remains an active reservation'
        # Caller cannot mutate underlying queues; the definer returns only its own hold.
        q('GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;')
        value=json.loads(q(f"SET ROLE authenticated; SET test.uid='{user}'; SELECT fn_cash_game_waitlist_position('{game}');"))
        assert value['reason']=='seat_reserved'
        before=q('SELECT md5(string_agg(row_to_json(w)::text,\'\')) FROM cash_game_waitlist w')
        read();read()
        assert before==q('SELECT md5(string_agg(row_to_json(w)::text,\'\')) FROM cash_game_waitlist w')
        with ThreadPoolExecutor(max_workers=2) as pool:
            concurrent=list(pool.map(lambda _:json.loads(q(f"SET test.uid='{other}'; SELECT fn_cash_game_join('{game}');")),range(2)))
        assert all(result['waiting']==2 and result['position']==2 for result in concurrent), 'Concurrent Join preserves one fresh place'
        renewed=concurrent[0]
        assert renewed['action']=='waitlisted' and renewed['waiting']==2 and renewed['position']==2
        assert read(uid=other)['on_list'] is True and read(uid=other)['reason']=='waiting_for_seat'
        assert q(f"SELECT count(*) FROM cash_game_waitlist WHERE user_id='{other}' AND status='waiting' AND created_at>now()-interval '1 minute'")=='1'
        assert q(f"SELECT count(*) FROM cash_game_waitlist WHERE user_id='{other}' AND status='expired'")=='1'
        json.loads(q(f"SET test.uid='{other}'; SELECT fn_cash_game_join('{game}');"))
        assert q(f"SELECT count(*) FROM cash_game_waitlist WHERE user_id='{other}' AND status='waiting'")=='1', 'Repeated Join retains the same live entry'
        print('PASS: actual queue reader and original Join tail, fresh rejoin after TTL, stable repeated Join, funding/full/free, private hold, thaw, role and read-only reader')
    finally:
        run([PG/'pg_ctl','-D',folder/'data','-m','immediate','-w','stop'])
