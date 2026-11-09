#!/usr/bin/env python3
"""PG17 composed original split return, autojournal and deferred invariant."""
import argparse,json,os,shutil,socket,subprocess,tempfile,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pg-bin',type=Path,required=True);p.add_argument('--scratch-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
r=Path(__file__).resolve().parents[2]; f=Path(__file__).parent/'fixtures/split-late-return';m=r/'supabase/retired-unapplied/20261109132114_split_late_credit_journals_its_own_return.sql'
e={k:v for k,v in os.environ.items() if not k.startswith('PG')};e['TMPDIR']=str(a.scratch_root)
w=Path(tempfile.mkdtemp(prefix='split-leg-',dir=a.scratch_root));d=w/'data';started=False
with socket.socket() as s:s.bind(('127.0.0.1',0));port=str(s.getsockname()[1])
def cmd(args):return subprocess.run(list(map(str,args)),env=e,text=True,capture_output=True,check=True)
def q(s,ok=True):
 z=subprocess.run([str(a.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres'],input=s,env=e,text=True,capture_output=True)
 if ok and z.returncode:raise RuntimeError(z.stderr)
 return z
try:
 assert '17.' in cmd([a.pg_bin/'postgres','--version']).stdout
 cmd([a.pg_bin/'initdb','-D',d,'-U','postgres','-A','trust','--no-locale'])
 cmd([a.pg_bin/'pg_ctl','-D',d,'-l',w/'log','-w','start','-o',f"-k '' -h 127.0.0.1 -p {port} -c fsync=off -c full_page_writes=off -c wal_level=minimal -c max_wal_senders=0"]);started=True
 q((f/'schema.sql').read_text())
 rows=json.loads((f/'actual-functions.json').read_text())
 for x in rows:q('SET check_function_bodies=off;'+x['body'])
 q((f/'wiring.sql').read_text())
 metadata="SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatile',provolatile,'parallel',proparallel)::text FROM pg_proc WHERE oid='fn_ca_horse_split_return_late_credit()'::regprocedure;"
 original_metadata=q(metadata).stdout.strip()
 cases=[]
 def exercise(skip,fail=False,repeat=False):
  s=(f/'case.sql').read_text().replace('@SKIP@',skip).replace('@REPEAT@', 'SELECT sr_pay(17);' if repeat else '')
  z=q(s,False)
  if fail:assert z.returncode and 'balance_moved_without_its_ledger_row' in z.stderr,z.stderr
  else:assert not z.returncode,z.stderr
  cases.append({'skip':skip,'repeat':repeat,'expected_refusal':fail,'passed':True,'stderr':z.stderr})
 exercise('1',True)
 guard_js="import { stalePinGuardSQL } from './scripts/ci/migration-stale-pins.mjs';import {readFileSync} from 'node:fs';const p=process.argv[1],s=readFileSync(p,'utf8');process.stdout.write(stalePinGuardSQL(p,s,s));"
 guarded=cmd(['node','--input-type=module','-e',guard_js,str(m)]).stdout
 prehash=q("SELECT md5(pg_get_functiondef('fn_ca_horse_split_return_late_credit()'::regprocedure));").stdout.strip()
 q("CREATE FUNCTION sr_stale_pin() RETURNS text LANGUAGE sql AS $$SELECT '"+prehash+"'::text$$;")
 rejected=q(guarded,False)
 assert rejected.returncode and 'migration_left_a_stale_pin' in rejected.stderr,'actual stale-pin refusal'
 assert q("SELECT md5(pg_get_functiondef('fn_ca_horse_split_return_late_credit()'::regprocedure));").stdout.strip()==prehash,'stale-pin refusal rolled back source'
 q('DROP FUNCTION sr_stale_pin();')
 q(guarded)
 for skip in ['1','']:
  exercise(skip);exercise(skip,repeat=True)
 q("DO $$BEGIN IF (SELECT proacl::text FROM pg_proc WHERE oid='fn_ca_horse_split_return_late_credit()'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}' THEN RAISE EXCEPTION 'acl_changed'; END IF;END$$;")
 assert q(metadata).stdout.strip()==original_metadata,'metadata changed'
 replay=q(guarded,False)
 assert replay.returncode and 'split_late_return_preimage_changed' in replay.stderr,'replay refused'
 post=q("SELECT md5(pg_get_functiondef('fn_ca_horse_split_return_late_credit()'::regprocedure));").stdout.strip()
 a.output.write_text(json.dumps({'passed':True,'cases':cases,'preimage':prehash,'actual_applier_stale_pin_refusal_and_rollback':True,'postimage':post,'limits':'Actual split/ledger/tally/guard functions; isolated payment statement replaces full R3. No production writes.'},indent=2)+'\n');print('passed',len(cases),'cases; postimage',post)
finally:
 if started:subprocess.run([str(a.pg_bin/'pg_ctl'),'-D',str(d),'-m','immediate','stop'],env=e,capture_output=True)
 shutil.rmtree(w)

# The existing directly-triggered financial route also checks the later R3
# wallet-opening boundary against this same real trigger/journal foundation.
subprocess.run([sys.executable,str(f/'wallet-opening/qualify-postgres.py'),
 '--pg-bin',str(a.pg_bin),'--scratch-root',str(a.scratch_root),
 '--output',str(a.output.with_name('split-wallet-opening.json'))],env=e,check=True)
