#!/usr/bin/env python3
"""Isolated original settings/record-grant configuration proof; no production connection."""
import argparse,importlib.util,json,hashlib,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--prerequisite-root',type=Path,default=ROOT);p.add_argument('--pg-bin',type=Path,required=True);args=p.parse_args()
if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
 raise SystemExit('external TMPDIR required')
spec=importlib.util.spec_from_file_location('promo_base',ROOT/'scripts/ci/test-promo-play-through.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
source=next((ROOT/'supabase/migrations').glob('*_enable_prospective_promo_play_through_after_installed_source.sql'))
# Exact original candidate prerequisite files are read-only inputs while HELD.
CANDIDATE=args.prerequisite_root
versions=['20261116151020','20261116195541','20261116153059','20261116154719','20261116154841','20261116161707','20261116163759','20261116190221','20261116200638','20261116214149']
prerequisites=[next((CANDIDATE/'supabase/migrations').glob(v+'_*.sql')) for v in versions]
output=args.output;output.mkdir(parents=True,exist_ok=False)
paths=[Path(__file__),source,Path(base.__file__),ROOT/'supabase/migrations/20261115210559_promo_play_through_lock_ledger_and_fee_meter.sql']+prerequisites
inputs={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths};tmp=Path(tempfile.mkdtemp(prefix='act-',dir=os.environ['TMPDIR']));pg=args.pg_bin;db=base.Db(str(tmp),55452,'activation');checks=[];started=False
sql=source.read_text()
def check(name,q,wanted):
 got=db.one(q);assert got==wanted,(name,got,wanted);checks.append(name)
def refuse(name):
 try:db.run(sql)
 except RuntimeError:pass
 else:raise AssertionError('activation accepted '+name)
 check(name+' rolls back settings',"SELECT enforced_from IS NULL AND multiplier=4 AND expiry_days=30 FROM ca_promo_play_through_settings",'t')
try:
 subprocess.run([pg/'initdb','-D',tmp/'data','-U','postgres','-A','trust'],check=True,capture_output=True)
 subprocess.run([pg/'pg_ctl','-D',tmp/'data','-w','-o',f"-p 55452 -k {tmp} -c listen_addresses=''",'-l',output/'postgres.log','start'],check=True,capture_output=True);started=True
 db.run('CREATE DATABASE activation',db='postgres');db.run(base.STUB);db.run(paths[3].read_text())
 db.run("CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text);")
 db.run('INSERT INTO supabase_migrations.schema_migrations VALUES '+','.join("('"+p.name[:14]+"','"+p.stem[15:]+"')" for p in prerequisites))
 # Existing normal balances and pre-go-live promo receipts are not reclassified.
 db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance) VALUES('{base.CLUB}','{base.ALICE}',1000) ON CONFLICT(club_id,user_id) DO UPDATE SET chip_balance=1000;SELECT fn_ca_promo_play_through_record_grant('{base.CLUB}','{base.ALICE}',50,'club_promo','before',NULL,'promo_wallet','{base.CLUB}',NULL)")
 check('preactivation original grant owner records no grant','SELECT count(*) FROM ca_promo_play_through_grants','0')
 for p in prerequisites:
  db.run("DELETE FROM supabase_migrations.schema_migrations WHERE version='"+p.name[:14]+"'");refuse('missing '+p.name[:14]);db.run("INSERT INTO supabase_migrations.schema_migrations VALUES('"+p.name[:14]+"','"+p.stem[15:]+"')")
 before=db.one('SELECT clock_timestamp()');db.run(sql);after=db.one('SELECT clock_timestamp()')
 check('activation uses its actual prospective clock',f"SELECT enforced_from BETWEEN '{before}'::timestamptz AND '{after}'::timestamptz AND multiplier=4 AND expiry_days=30 FROM ca_promo_play_through_settings",'t')
 check('activation never scans balances into retroactive grants','SELECT count(*) FROM ca_promo_play_through_grants','0')
 db.run(f"SELECT fn_ca_promo_play_through_record_grant('{base.CLUB}','{base.ALICE}',50,'club_promo','after',NULL,'promo_wallet','{base.CLUB}',NULL)")
 check('first new fifty chip gift has exact two hundred fee target',"SELECT amount=50 AND remaining=50 AND fee_target=200 AND granted_at>=(SELECT enforced_from FROM ca_promo_play_through_settings) AND expires_at-granted_at=interval '30 days' FROM ca_promo_play_through_grants",'t')
 enabled=db.one('SELECT enforced_from FROM ca_promo_play_through_settings')
 try:db.run(sql)
 except RuntimeError:pass
 else:raise AssertionError('activation reset accepted')
 check('already activated clock is never reset',"SELECT enforced_from::text FROM ca_promo_play_through_settings",enabled)
 db.run('UPDATE ca_promo_play_through_settings SET enforced_from=NULL');refuse('unexpected existing grants')
 check('configuration never edits existing wallet',f"SELECT chip_balance FROM club_members WHERE club_id='{base.CLUB}' AND user_id='{base.ALICE}'",'1000')
 assert all(hashlib.sha256(p.read_bytes()).hexdigest()==inputs[str(p)] for p in paths)
 (output/'RESULTS.json').write_text(json.dumps({'status':'passed','checks':checks,'source_sha256':inputs,'production_mutations':False,'qualification_limits':['Real original cold settings and record-grant functions; migration history is explicit isolated installation evidence. No financial payments, no engine/client/legal-live claim, no W money requalification. Existing W2 source untouched. HELD: never apply before root verifies all external prerequisites.']},indent=2)+'\n');print(len(checks),'configuration checks passed')
finally:
 if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','-w','stop'],capture_output=True)
