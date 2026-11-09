#!/usr/bin/env python3
"""PG17 split-return x payout-stage chain: the demonstrated 2026-11-09 defect,
every installed repair in production order, the refused competitor, rollback
safety and no duplicate after retry. Actual captured functions; no production
writes."""
import argparse,json,os,shutil,socket,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pg-bin',type=Path,required=True);p.add_argument('--scratch-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
r=Path(__file__).resolve().parents[2]; f=Path(__file__).parent/'fixtures/split-late-return'
M=r/'supabase/migrations'
CHAIN=[('20261109132254_the_split_late_return_writes_its_leg_inside_any_door.sql','e1bd766347c196e52e891da762e76403'),
       ('20261109140919_the_split_return_leg_lands_before_the_debit.sql','b4d29a312a1d98b8a1b9c9ef7d0bb19b'),
       ('20261109142552_the_return_restores_the_callers_cash_debit_ledger_key.sql','11e4e7463bc340aae5a503fdde91aca7')]
SUPERSEDED='20261109132114_split_late_credit_journals_its_own_return.sql'
PRE='702e02688fc458ee7954baee99e0f65b'
e={k:v for k,v in os.environ.items() if not k.startswith('PG')};e['TMPDIR']=str(a.scratch_root)
w=Path(tempfile.mkdtemp(prefix='split-leg-',dir=a.scratch_root));d=w/'data';started=False
with socket.socket() as s:s.bind(('127.0.0.1',0));port=str(s.getsockname()[1])
def cmd(args):return subprocess.run(list(map(str,args)),env=e,text=True,capture_output=True,check=True)
def q(s,ok=True):
 z=subprocess.run([str(a.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres'],input=s,env=e,text=True,capture_output=True)
 if ok and z.returncode:raise RuntimeError(z.stderr)
 return z
def fn_md5():return q("SELECT md5(pg_get_functiondef('fn_ca_horse_split_return_late_credit()'::regprocedure));").stdout.strip()
cases=[]
def record(name,**kv):cases.append({'case':name,**kv,'passed':True})
def refuse(name,sql,token):
 z=q(sql,False);assert z.returncode and token in z.stderr,f'{name}: expected {token}, got rc={z.returncode} {z.stderr}'
 record(name,refusal=token)
def exercise(skip,fail=False,repeat=False,preserve=True,stage='chain'):
 s=(f/'case.sql').read_text().replace('@SKIP@',skip).replace('@REPEAT@','SELECT sr_pay(17);' if repeat else '')
 s=s.replace('@ORIG@','true' if not preserve else "current_setting('app.cash_original_debit_ledger')='caller-original' OR '"+skip+"'=''")
 z=q(s,False)
 if fail:assert z.returncode and 'balance_moved_without_its_ledger_row' in z.stderr,f'{stage} skip={skip}: {z.stderr}'
 else:assert not z.returncode,f'{stage} skip={skip} repeat={repeat}: {z.stderr}'
 record(f'{stage} skip={skip!r} repeat={repeat}',expected_refusal=fail,preserve_asserted=preserve)
try:
 assert '17.' in cmd([a.pg_bin/'postgres','--version']).stdout
 cmd([a.pg_bin/'initdb','-D',d,'-U','postgres','-A','trust','--no-locale'])
 cmd([a.pg_bin/'pg_ctl','-D',d,'-l',w/'log','-w','start','-o',f"-k '' -h 127.0.0.1 -p {port} -c fsync=off -c full_page_writes=off -c wal_level=minimal -c max_wal_senders=0"]);started=True
 q((f/'schema.sql').read_text())
 for x in json.loads((f/'actual-functions.json').read_text()):q('SET check_function_bodies=off;'+x['body'])
 q((f/'wiring.sql').read_text())
 metadata="SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatile',provolatile,'parallel',proparallel)::text FROM pg_proc WHERE oid='fn_ca_horse_split_return_late_credit()'::regprocedure;"
 original_metadata=q(metadata).stdout.strip()
 assert fn_md5()==PRE,'captured fixture drifted from the pinned preimage'
 # 1. The original defect: the payout stage's suppressed member autoledger
 #    swallows the return leg and the deferred invariant refuses the round.
 exercise('1',True)
 # 2. 20261109132254 installs but the 14:04Z production outcome holds: the
 #    clear landed after the debit, so the identical refusal remains.
 q((M/CHAIN[0][0]).read_text());assert fn_md5()==CHAIN[0][1],'post-132254 md5'
 exercise('1',True,stage='post-132254')
 # 3. The competitor merged four minutes later and must refuse exactly as
 #    production refused it at 14:09Z; that refusal is the SUPERSEDED basis.
 refuse('superseded-132114-refuses',(M/SUPERSEDED).read_text(),'split_late_return_preimage_changed')
 # 4. The reconciliation names its exact missing prerequisite when offered
 #    out of order.
 refuse('142552-names-prerequisite',(M/CHAIN[2][0]).read_text(),'requires 20261109140919 installed first')
 # 5. 20261109140919: the leg lands before the debit; every door pays. The
 #    caller's cash-debit key is not yet restored, which is step 6's job.
 q((M/CHAIN[1][0]).read_text());assert fn_md5()==CHAIN[1][1],'post-140919 md5'
 for skip in ['1','']:
  exercise(skip,preserve=False,stage='post-140919');exercise(skip,repeat=True,preserve=False,stage='post-140919')
 # 6. 20261109142552: the caller's declared cash-debit journal state is
 #    saved and restored around every return, including two in one
 #    transaction.
 q((M/CHAIN[2][0]).read_text());assert fn_md5()==CHAIN[2][1],'post-142552 md5'
 for skip in ['1','']:
  exercise(skip,stage='post-chain');exercise(skip,repeat=True,stage='post-chain')
 # 7. Safe rollback: a fault after the return commits NOTHING - no wallet
 #    move, no bank move, no return receipt, no ledger leg.
 z=q((f/'case-fault.sql').read_text(),False);assert z.returncode and 'injected_fault' in z.stderr,z.stderr
 clean=q("SELECT ((SELECT chip_treasury=1000 FROM clubs) AND (SELECT chip_balance=0 FROM club_members))::text||'|'||(SELECT count(*) FROM chip_ledger)||'|'||(SELECT count(*) FROM ca_horse_club_split_late_returns);").stdout.strip()
 assert clean=='true|0|0',f'rolled-back attempt left state: {clean}'
 record('fault-rolls-back-whole-payment',state=clean)
 # 8. No duplicate after retry: the committed retry of the failed attempt
 #    yields exactly one return receipt and one leg pair, balanced.
 q((f/'case-commit.sql').read_text())
 once=q("SELECT ((SELECT chip_treasury=1000 FROM clubs) AND (SELECT chip_balance=0 FROM club_members))::text||'|'||(SELECT count(*) FROM chip_ledger)||'|'||(SELECT count(*) FROM ca_horse_club_split_late_returns)||'|'||(SELECT count(DISTINCT idempotency_key) FROM chip_ledger);").stdout.strip()
 assert once=='true|2|1|2',f'retry did not pay exactly once: {once}'
 record('retry-pays-exactly-once',state=once)
 # 9. Installed repairs never replay, and the function's authority surface
 #    is exactly what it was.
 refuse('140919-never-replays',(M/CHAIN[1][0]).read_text(),'split_return_trigger_preimage_changed')
 refuse('142552-never-replays',(M/CHAIN[2][0]).read_text(),'split_return_trigger_preimage_changed')
 q("DO $$BEGIN IF (SELECT proacl::text FROM pg_proc WHERE oid='fn_ca_horse_split_return_late_credit()'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}' THEN RAISE EXCEPTION 'acl_changed'; END IF;END$$;")
 assert q(metadata).stdout.strip()==original_metadata,'metadata changed'
 a.output.write_text(json.dumps({'passed':True,'cases':cases,'postimage':fn_md5(),'limits':'Actual split/ledger/tally/guard functions; isolated payment statement replaces full R3. No production writes.'},indent=2)+'\n');print('passed',len(cases),'cases; postimage',fn_md5())
finally:
 if started:subprocess.run([str(a.pg_bin/'pg_ctl'),'-D',str(d),'-m','immediate','stop'],env=e,capture_output=True)
 shutil.rmtree(w)
