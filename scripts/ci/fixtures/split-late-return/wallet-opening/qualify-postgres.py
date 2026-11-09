#!/usr/bin/env python3
"""PG17 exact R3 wallet boundary blocks with real split/journal/commit guards.
Unchanged payee qualification is an explicit fixed-payee adapter. The full R3
body is installed byte-exact for migration/metadata checks, not invoked here.
"""
import argparse,json,os,shutil,socket,subprocess,tempfile,select
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pg-bin',type=Path,required=True);p.add_argument('--scratch-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
r=Path(__file__).resolve().parents[5];f=Path(__file__).parent;base=f.parent;m=r/'supabase/migrations/20261109152132_split_returns_measure_from_locked_wallet_opening.sql'
e={k:v for k,v in os.environ.items() if not k.startswith('PG')};e['TMPDIR']=str(a.scratch_root)
w=Path(tempfile.mkdtemp(prefix='wallet-opening-',dir=a.scratch_root));d=w/'data';started=False;cases=[]
with socket.socket() as s:s.bind(('127.0.0.1',0));port=str(s.getsockname()[1])
psql=[str(a.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres']
def cmd(args):return subprocess.run(list(map(str,args)),env=e,text=True,capture_output=True,check=True,timeout=90)
def q(s,ok=True):
 z=subprocess.run(psql,input=s,env=e,text=True,capture_output=True,timeout=60)
 if ok and z.returncode:raise RuntimeError(z.stderr[:3000])
 return z
def wrapper(source):
 # Extract actual complete lock/opening and final player-model blocks. No
 # copied model, timestamp substitute or hand-written assertion replaces them.
 opening=source[source.index(' PERFORM cm.user_id FROM public.club_members'):source.index(' PERFORM a.id FROM public.agents')]
 final=source[source.index(' CREATE TEMP TABLE IF NOT EXISTS _routed_split_returns('):source.index(' IF EXISTS(SELECT 1 FROM pg_temp._routed_agent_wallets w LEFT JOIN public.agents')]
 baseline=''
 if ' -- Wallets above are locked:' in source:
  baseline=source[source.index(' -- Wallets above are locked:'):source.index(" deleted_deferral:=current_setting('app.deleted_wallet_routing_stage',true);")]
 table=source[source.index(' CREATE TEMP TABLE IF NOT EXISTS _routed_player_wallets('):source.index(' TRUNCATE pg_temp._routed_player_wallets;')]
 return "CREATE OR REPLACE FUNCTION sr_stage(n numeric)RETURNS void LANGUAGE plpgsql AS $stage$DECLARE BEGIN\n"+table+"TRUNCATE pg_temp._routed_player_wallets;INSERT INTO pg_temp._routed_player_wallets(club_id,user_id,delta)VALUES(md5('club')::uuid,md5('horse')::uuid,n);\n"+opening+baseline+"PERFORM sr_pay(n);IF current_setting('sr.bad_receipt',true)='1' THEN INSERT INTO ca_horse_club_split_late_returns(club_id,horse_id,amount)VALUES(md5('club')::uuid,md5('horse')::uuid,1);END IF;\n"+final+"END $stage$;"
def reset():q('TRUNCATE chip_ledger,chip_transactions,ca_horse_club_split_late_returns,financial_alerts;')
def invariant():
 q("SELECT sr_assert((SELECT chip_treasury=1000 FROM clubs),'bank unchanged');SELECT sr_assert((SELECT chip_balance=0 FROM club_members),'wallet zero');SELECT sr_assert((SELECT count(*)=0 FROM financial_alerts),'no hidden deferral');SELECT sr_assert((SELECT count(*) FROM chip_ledger)=2*(SELECT count(*) FROM ca_horse_club_split_late_returns),'exact payment/return legs');")
def exercise(name,body,refusal=False):
 reset();z=q("BEGIN;SET LOCAL app.ledger_autoskip_club_members='1';"+body+"SET CONSTRAINTS ALL IMMEDIATE;COMMIT;",False)
 assert bool(z.returncode)==refusal,(name,z.stderr)
 if refusal:assert 'routed_rakeback_final_balance_incorrect' in z.stderr,z.stderr
 invariant();cases.append({'case':name,'expected_refusal':refusal,'passed':True,'stderr':z.stderr})
def before_lock(name,refusal=False):
 reset();a1=subprocess.Popen(psql,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=e,text=True,bufsize=1)
 a1.stdin.write("BEGIN;SET LOCAL app.ledger_autoskip_club_members='1';SELECT 'started:'||txid_current();\n");a1.stdin.flush()
 assert select.select([a1.stdout],[],[],10)[0],'first real transaction start timeout'
 marker=a1.stdout.readline().strip();assert marker.startswith('started:'),marker
 # B commits an actual credit, split-return receipt and both journal legs
 # after A's transaction began but before A locks/captures its wallet opening.
 q("BEGIN;SET LOCAL app.ledger_autoskip_club_members='1';SELECT sr_pay(7);COMMIT;")
 a1.stdin.write("SELECT sr_stage(11);SET CONSTRAINTS ALL IMMEDIATE;COMMIT;\n");a1.stdin.close();a1.stdin=None
 out,err=a1.communicate(timeout=30)
 assert bool(a1.returncode)==refusal,(name,out,err)
 if refusal:assert 'routed_rakeback_final_balance_incorrect' in err,err
 invariant();total=q('SELECT sum(amount) FROM ca_horse_club_split_late_returns;').stdout.strip()
 assert total==('7'if refusal else'18'),(name,total)
 cases.append({'case':name,'two_distinct_transactions':True,'passed':True,'expected_refusal':refusal,'committed_return_total':total,'stderr':err})
try:
 assert '17.' in cmd([a.pg_bin/'postgres','--version']).stdout
 cmd([a.pg_bin/'initdb','-D',d,'-U','postgres','-A','trust','--no-locale'])
 cmd([a.pg_bin/'pg_ctl','-D',d,'-l',w/'log','-w','start','-o',f"-k '' -h 127.0.0.1 -p {port} -c fsync=off -c full_page_writes=off -c wal_level=minimal -c max_wal_senders=0"]);started=True
 q((base/'schema.sql').read_text())
 q('ALTER TABLE ca_horse_club_split_late_returns ADD COLUMN returned_at timestamptz DEFAULT clock_timestamp();')
 for x in json.loads((base/'actual-functions.json').read_text()):q('SET check_function_bodies=off;'+x['body'])
 q((f/'trigger-current.sql').read_text());q((base/'wiring.sql').read_text())
 before=(f/'stage-before.sql').read_text();q('SET check_function_bodies=off;'+before)
 q("CREATE ROLE service_role;REVOKE ALL ON FUNCTION fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)FROM PUBLIC;GRANT EXECUTE ON FUNCTION fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)TO service_role;")
 metadata="SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatile',provolatile,'parallel',proparallel)::text FROM pg_proc WHERE oid='fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure;"
 old_metadata=q(metadata).stdout.strip();q(wrapper(before))
 exercise('old-ordinary-no-prior-return','SELECT sr_stage(11);')
 before_lock('old-return-commits-before-wallet-opening',True)
 exercise('old-earlier-call-in-same-transaction','SELECT sr_stage(11);SELECT sr_stage(17);',True)
 js="import{stalePinGuardSQL}from './scripts/ci/migration-stale-pins.mjs';import{readFileSync}from'node:fs';let p=process.argv[1],s=readFileSync(p,'utf8');process.stdout.write(stalePinGuardSQL(p,s,s));"
 guarded=cmd(['node','--input-type=module','-e',js,str(m)]).stdout;q('SET check_function_bodies=off;'+guarded)
 after=q("SELECT pg_get_functiondef('fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);").stdout
 assert after==(f/'stage-after.sql').read_text()+'\n','exact installed postimage'
 assert q(metadata).stdout.strip()==old_metadata,'metadata/ACL changed'
 q(wrapper(after))
 exercise('new-ordinary-no-prior-return','SELECT sr_stage(11);')
 before_lock('new-return-commits-before-wallet-opening')
 exercise('new-earlier-call-in-same-transaction','SELECT sr_stage(11);SELECT sr_stage(17);')
 exercise('new-receipt-without-matching-wallet-move-still-refused',"SET LOCAL sr.bad_receipt='1';SELECT sr_stage(11);",True)
 replay=q('SET check_function_bodies=off;'+guarded,False);assert replay.returncode and 'split_wallet_opening_preimage_changed' in replay.stderr
 a.output.write_text(json.dumps({'passed':True,'cases':cases,'metadata_preserved':True,'applier_stale_pin_guard':True,'replay_refused':True,'limit':'Exact changed R3 blocks and actual split/journal/deferred guard. Fixed payee/payment adapter; full entitlement stage not invoked. No production financial probes.'},indent=2)+'\n');print('PASS',len(cases),'connected wallet-opening cases')
finally:
 if started:subprocess.run([str(a.pg_bin/'pg_ctl'),'-D',str(d),'-m','immediate','stop'],env=e,capture_output=True)
 shutil.rmtree(w)
