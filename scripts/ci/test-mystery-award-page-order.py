#!/usr/bin/env python3
"""Exercise the actual mystery award reader and exact migration in isolated PG17."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / 'supabase/migrations/20261031224551_mystery_award_pages_have_a_stable_identity_order.sql'
BASELINE = ROOT / 'supabase/migrations/20260825410000_mystery_bounty_chest_inventory.sql'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    args = parser.parse_args()
    pg = args.pg_bin.resolve()
    def run(command, **kwargs):
        return subprocess.run(command, text=True, capture_output=True, check=True, timeout=30, **kwargs)
    if ' 17.' not in run([str(pg / 'postgres'), '--version']).stdout:
        raise ValueError('PostgreSQL17 required')
    base = Path(tempfile.mkdtemp(prefix='mb-order-', dir=args.scratch.resolve()))
    started = False
    try:
        run([str(pg / 'initdb'), '-D', str(base/'data'), '-A', 'trust', '--no-locale', '-U', 'postgres'])
        run([str(pg / 'pg_ctl'), '-D', str(base/'data'), '-l', str(base/'pg.log'), '-o', f"-k {base} -p 55439 -c listen_addresses=''", '-w', 'start'])
        started = True
        def sql(statement):
            return run([str(pg/'psql'), '-h', str(base), '-p', '55439', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], input=statement).stdout.strip()
        source = BASELINE.read_text()
        start = source.index('CREATE OR REPLACE FUNCTION public.fn_mystery_bounty_awards(')
        end = source.index('$function$;', start) + len('$function$;')
        function = source[start:end]
        sql('''CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon;
CREATE TABLE public.tournament_bounty_awards(id uuid PRIMARY KEY, tournament_id uuid, status text,amount_cents bigint,tier text,revealed_at timestamptz,hand_id uuid,table_id uuid,eliminated_user_id uuid);
CREATE TABLE public.tournament_bounty_award_recipients(award_id uuid,user_id uuid,amount_cents bigint);
CREATE TABLE public.tournament_players(tournament_id uuid,user_id uuid,username text);
INSERT INTO public.tournament_bounty_awards SELECT md5(i::text)::uuid,'00000000-0000-4000-8000-000000000001','paid',i,'base','2026-10-31',NULL,NULL,NULL FROM generate_series(1,1002) i;
''' + function + '''
REVOKE ALL ON FUNCTION public.fn_mystery_bounty_awards(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_mystery_bounty_awards(uuid,integer,integer) TO authenticated,service_role;
''')
        query = """WITH pages AS (SELECT public.fn_mystery_bounty_awards('00000000-0000-4000-8000-000000000001',200,n) r FROM generate_series(0,1000,200) n), ids AS (SELECT value->>'award_id' id FROM pages,jsonb_array_elements(r->'rows')) SELECT jsonb_build_object('rows',count(*),'distinct',count(DISTINCT id)) FROM ids;"""
        before = json.loads(sql(query))
        # The retained regression fails on the exact original SQL, not a model.
        assert before['rows'] == 1002 and before['distinct'] < 1002, before
        identity = "SELECT jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'volatility',provolatile,'config',proconfig) FROM pg_proc WHERE oid='public.fn_mystery_bounty_awards(uuid,integer,integer)'::regprocedure;"
        authority = sql(identity)
        sql(CANDIDATE.read_text())
        assert sql(identity) == authority, 'reader authority changed'
        after = json.loads(sql(query))
        assert after == {'rows':1002,'distinct':1002}, after
        # Equal NULL timestamps, alternate paid states, and excluded records.
        sql("UPDATE public.tournament_bounty_awards SET revealed_at=NULL,status='completed'; INSERT INTO public.tournament_bounty_awards(id,tournament_id,status,amount_cents) VALUES('ffffffff-ffff-ffff-ffff-ffffffffffff','00000000-0000-4000-8000-000000000001','reserved',999999);")
        assert json.loads(sql(query)) == after
        assert sql("SET ROLE authenticated; SELECT jsonb_array_length(public.fn_mystery_bounty_awards('00000000-0000-4000-8000-000000000001',999,0)->'rows');") == 'SET\n200'
        assert sql("SELECT public.fn_mystery_bounty_awards('00000000-0000-4000-8000-000000000002',200,0)->>'total';") == '0'
        assert sql("SELECT jsonb_array_length(public.fn_mystery_bounty_awards('00000000-0000-4000-8000-000000000001',200,1002)->'rows');") == '0'
        assert sql("SELECT has_function_privilege('anon','public.fn_mystery_bounty_awards(uuid,integer,integer)','EXECUTE');") == 'f'
        try:
            sql(CANDIDATE.read_text())
        except subprocess.CalledProcessError as error:
            assert 'MYSTERY_AWARD_ORDER_PREIMAGE_CHANGED' in error.stderr
        else:
            raise AssertionError('unexpected preimage accepted')
        print(json.dumps({'before':before,'after':after,'authorityPreserved':True,'nullTies':True,'pageClamp':True,'excludedStatus':True,'emptyEvent':True,'replayRefused':True,'migrationSHA256':hashlib.sha256(CANDIDATE.read_bytes()).hexdigest()}))
    finally:
        if started:
            run([str(pg/'pg_ctl'), '-D', str(base/'data'), '-m','fast','-w','stop'])
        shutil.rmtree(base)

if __name__ == '__main__':
    main()
