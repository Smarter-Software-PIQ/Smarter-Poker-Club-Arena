#!/usr/bin/env python3
"""Real paying-wallet resolvers and new read RPC in disposable PostgreSQL17."""
import json, os, re, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = Path(os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP') or tempfile.gettempdir())
if __import__('sys').platform == 'darwin' and not str(BASE).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Use task-owned external SSD scratch')
ENV = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
def main():
    passed=[]
    def check(name, ok):
        if not ok: raise AssertionError(name)
        passed.append(name)
    with tempfile.TemporaryDirectory(prefix='hpw-', dir=BASE) as folder:
        d=Path(folder); sock=d/'s'; sock.mkdir()
        def cmd(args): return subprocess.run([str(v) for v in args],env=ENV,text=True,capture_output=True,check=True).stdout
        cmd([PG/'initdb','-D',d/'db','-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
        cmd([PG/'pg_ctl','-D',d/'db','-l',d/'log','-o',f"-k {sock} -p 55482 -c listen_addresses='' -c shared_buffers=16MB",'-w','start'])
        def run(sql, fail=False):
            p=subprocess.run([str(PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-h',str(sock),'-p','55482','-U','postgres','-d','postgres','-c',sql],env=ENV,text=True,capture_output=True)
            if p.returncode and not fail: raise AssertionError(p.stderr)
            return p.stderr if fail else p.stdout.strip()
        h='00000000-0000-4000-8000-000000000001';t='00000000-0000-4000-8000-000000000002'
        c1='00000000-0000-4000-8000-000000000003';c2='00000000-0000-4000-8000-000000000004';u='00000000-0000-4000-8000-000000000005'
        try:
            run('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE profiles(id uuid PRIMARY KEY,is_horse boolean,horse_status text);
CREATE TABLE tournaments(id uuid PRIMARY KEY,club_id uuid,union_id uuid,buy_in_amount numeric,buy_in_fee numeric,bounty_amount numeric,is_bounty boolean,is_pko boolean,is_mystery_bounty boolean,name text DEFAULT 'PKO',status text DEFAULT 'REGISTERING',start_time timestamptz DEFAULT now()+interval '10 minutes',guaranteed_prize numeric DEFAULT 5000,current_players integer DEFAULT 18,max_players integer,format_contract text DEFAULT 'mtt-v2');
CREATE TABLE club_members(user_id uuid,club_id uuid,chip_balance numeric,status text,joined_at timestamptz,PRIMARY KEY(user_id,club_id));
CREATE TABLE union_clubs(club_id uuid,union_id uuid);CREATE TABLE clubs(id uuid,union_id uuid);
CREATE TABLE tournament_players(tournament_id uuid,user_id uuid,club_id uuid);
CREATE FUNCTION fn_ca_tournament_unit_cents(uuid) RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
CREATE FUNCTION fn_ca_read_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$SELECT 'unlimited-mtt-v2'::text$$;''')
            split=(ROOT/'supabase/migrations/20260823000000_fix_entry_split_no_default_rake.sql').read_text()
            run(re.search(r'CREATE OR REPLACE FUNCTION public.fn_tournament_entry_split\(.*?\$function\$;',split,re.S).group())
            run((ROOT/'tests/sql/fixtures/horse-overlay-risk-before.sql').read_text())
            run('REVOKE ALL ON FUNCTION fn_overlay_at_risk(uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION fn_overlay_at_risk(uuid) TO service_role;')
            source=(ROOT/'supabase/migrations/20261012131301_a_buyin_draws_from_the_wallet_that_can_pay_and_no_unfunded_s.sql').read_text()
            for name in ['fn_ca_union_wallet_that_can_pay','fn_ca_entry_paying_club','fn_tournament_club_for_user']:
                fn=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\(.*?\$function\$\s*;',source,re.S)
                if not fn: raise AssertionError('missing maintained resolver '+name)
                run(fn.group())
            files=list((ROOT/'supabase/migrations').glob('*_horse_tournament_bankroll_uses_paying_wallet.sql'))
            check('one reserved maintained migration',len(files)==1)
            run(f"INSERT INTO profiles VALUES('{h}',true,'available');INSERT INTO tournaments(id,club_id,union_id,buy_in_amount,buy_in_fee,bounty_amount,is_bounty,is_pko,is_mystery_bounty) VALUES('{t}','{u}','{u}',45,5,25,false,true,false);INSERT INTO union_clubs VALUES('{c1}','{u}'),('{c2}','{u}');INSERT INTO club_members VALUES('{h}','{c1}',10000,'active',now()),('{h}','{c2}',10000,'approved',now());")
            check('preimage incorrectly treats112 PKO entries as funded',run('SELECT entries_needed FROM fn_overlay_at_risk(NULL)')=='112')
            metadata="SELECT jsonb_build_object('owner',proowner,'acl',proacl,'secdef',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='fn_overlay_at_risk(uuid)'::regprocedure"
            before_metadata=run(metadata)
            run(files[0].read_text())
            check('PKO target uses20 prize contribution rather than45 gross',run('SELECT entries_needed FROM fn_overlay_at_risk(NULL)')=='250')
            check('PKO shortfall and diagnostic buyin share agree',run("SELECT shortfall::text||'/'||buy_in::text FROM fn_overlay_at_risk(NULL)")=='232/20.00')
            check('unlimited admission ABI is preserved',run('SELECT max_players IS NULL FROM fn_overlay_at_risk(NULL)')=='t')
            check('overlay owner ACL and config preserved',run(metadata)==before_metadata)
            run(f"INSERT INTO clubs VALUES('{u}','{u}');")
            check('host scope retained',run(f"SELECT count(*) FROM fn_overlay_at_risk('{u}')")=='1' and run(f"SELECT count(*) FROM fn_overlay_at_risk('{c1}')")=='0')
            run("UPDATE tournaments SET format_contract='legacy',max_players=40;")
            check('legacy capacity remains bounded',run("SELECT max_players::text||'/'||shortfall::text FROM fn_overlay_at_risk(NULL)")=='40/22')
            run("UPDATE tournaments SET format_contract='mtt-v2',max_players=NULL,current_players=250;")
            check('fully funded PKO is not at risk',run('SELECT count(*) FROM fn_overlay_at_risk(NULL)')=='0')
            run("UPDATE tournaments SET current_players=18,bounty_amount=45;")
            check('all-bounty entry cannot fund regular guarantee',run('SELECT count(*) FROM fn_overlay_at_risk(NULL)')=='0')
            run("UPDATE tournaments SET buy_in_amount=180,buy_in_fee=20,bounty_amount=0,is_pko=false,guaranteed_prize=40000;")
            check('ordinary200 net180 still needs223 entries',run('SELECT entries_needed FROM fn_overlay_at_risk(NULL)')=='223')
            run("UPDATE tournaments SET status='COMPLETED';")
            check('terminal event remains excluded',run('SELECT count(*) FROM fn_overlay_at_risk(NULL)')=='0')
            run("UPDATE tournaments SET status='RUNNING',start_time=now()-interval '31 minutes';")
            check('existing overlay selector window retained',run('SELECT count(*) FROM fn_overlay_at_risk(NULL)')=='0')
            run("UPDATE tournaments SET status='REGISTERING',start_time=now()+interval '10 minutes',buy_in_amount=45,buy_in_fee=5,bounty_amount=25,is_pko=true,guaranteed_prize=5000;")
            default=run(f"SELECT fn_tournament_club_for_user('{h}','{t}',NULL)")
            other=c2 if default==c1 else c1
            call=f"SELECT row_to_json(x) FROM fn_ca_horse_tournament_bankrolls('{t}',ARRAY['{h}'::uuid]) x"
            run(f"UPDATE club_members SET chip_balance=5.63 WHERE club_id='{other}';")
            result=json.loads(run(call))
            check('rich default is not judged by broke unrelated wallet',result['club_id']==default and result['chip_balance']==10000)
            run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{default}';UPDATE club_members SET chip_balance=10000 WHERE club_id='{other}';")
            result=json.loads(run(call))
            check('solvent default retained even with richer alternative',result['club_id']==default and result['chip_balance']==50)
            run(f"UPDATE club_members SET chip_balance=0 WHERE club_id='{default}';")
            result=json.loads(run(call))
            check('insolvent default uses ordinary funded fallback',result['club_id']==other and result['chip_balance']==10000)
            run(f"INSERT INTO tournament_players VALUES('{t}','{h}','{default}');")
            result=json.loads(run(call))
            check('existing entry retains its stamped wallet',result['club_id']==default and result['chip_balance']==0)
            run('TRUNCATE tournament_players;')
            run(f"UPDATE tournaments SET union_id=NULL,club_id='{c1}';")
            check('standalone resolves only host wallet',json.loads(run(call))['club_id']==c1)
            check('duplicate inputs return one row',run(f"SELECT count(*) FROM fn_ca_horse_tournament_bankrolls('{t}',ARRAY['{h}'::uuid,'{h}'::uuid])")=='1')
            check('missing tournament gives unknown not zero',run(f"SELECT count(*) FROM fn_ca_horse_tournament_bankrolls(gen_random_uuid(),ARRAY['{h}'::uuid])")=='0')
            run(f"UPDATE club_members SET chip_balance=NULL WHERE club_id='{c1}';")
            check('null balance stays unknown',json.loads(run(call))['chip_balance'] is None)
            run(f"UPDATE profiles SET horse_status='disabled';")
            check('retired identity excluded',run(f"SELECT count(*) FROM fn_ca_horse_tournament_bankrolls('{t}',ARRAY['{h}'::uuid])")=='0')
            run(f"UPDATE profiles SET horse_status='available',is_horse=false;")
            check('human wallet not exposed through horse RPC',run(f"SELECT count(*) FROM fn_ca_horse_tournament_bankrolls('{t}',ARRAY['{h}'::uuid])")=='0')
            check('anonymous denied','permission denied' in run('SET ROLE anon;'+call,True))
            check('authenticated denied','permission denied' in run('SET ROLE authenticated;'+call,True))
            check('service role allowed',run('SET ROLE service_role;'+f"SELECT count(*) FROM fn_ca_horse_tournament_bankrolls('{t}',ARRAY['{h}'::uuid])").splitlines()[-1]=='0')
            check('read leaves all wallets intact',run('SELECT count(*) FROM club_members')=='2')
            check('migration replay refuses changed overlay preimage','horse_overlay_prize_share_preimage_changed' in run(files[0].read_text(),True))
            print(json.dumps({'passed':len(passed),'checks':passed,'scope':'real paying-wallet resolvers, entry split and overlay selector; unit helper is isolated'}))
        finally: cmd([PG/'pg_ctl','-D',d/'db','-m','immediate','-w','stop'])
if __name__=='__main__':main()
