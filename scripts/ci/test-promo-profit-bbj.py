"""Actual captured BBJ recipient; typed monetary stores and W-constructor sink.

This proves original seat/wallet/park/replay producer wiring, not full BBJ pool
allocation, financial journal topology, or the independently qualified 2x core.
"""
import argparse,hashlib,importlib.util,json,os,subprocess,tempfile,uuid,sys
from pathlib import Path
from decimal import Decimal,InvalidOperation
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('base',ROOT/'scripts/ci/test-promo-play-through.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--bbj-source',type=Path);parser.add_argument('--baseline',action='store_true');parser.add_argument('--profit-source',type=Path,help='Full W migration for the actual bank proof; default is the maintained190221 source');args=parser.parse_args()
if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
PG=Path(base.pg_bin());OUT=args.output;OUT.mkdir(parents=True,exist_ok=False)
CAPTURE=ROOT/'tests/fixtures/promo-profit-bbj/recipient-owner.json'
owner=json.loads(CAPTURE.read_text())
(OUT/'original-recipient.json').write_text(json.dumps(owner,indent=2)+'\n')
draft=args.bbj_source or ROOT/'supabase/migrations/20261116190221_promo_winnings_retain_original_source_until_two_times_paid_f.sql'
source=draft.read_text()
if '-- BEGIN ORIGINAL BBJ WINNINGS SOURCE' in source:source=source.split('-- BEGIN ORIGINAL BBJ WINNINGS SOURCE',1)[1].split('-- END ORIGINAL BBJ WINNINGS SOURCE',1)[0].strip()
elif args.bbj_source is None:raise RuntimeError('Maintained W source is missing its original BBJ source markers')
(OUT/'INPUTS.json').write_text(json.dumps({'harness_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'capture_sha256':hashlib.sha256(CAPTURE.read_bytes()).hexdigest(),'source_sha256':hashlib.sha256(draft.read_bytes()).hexdigest(),'selected_bbj_source_sha256':hashlib.sha256(source.encode()).hexdigest()},indent=2)+'\n')
checks=[]
def uid():return str(uuid.uuid4())
C,A,T,H,P=map(lambda _:uid(),range(5))
with tempfile.TemporaryDirectory(prefix='pb-') as d:
 db=base.Db(d,54442,'postgres');started=False
 try:
  subprocess.run([PG/'initdb','-D',Path(d)/'data','-U','postgres','-A','trust','--no-locale'],check=True,capture_output=True)
  subprocess.run([PG/'pg_ctl','-D',Path(d)/'data','-l',Path(d)/'log','-o',f"-F -k {d} -p 54442 -c listen_addresses=''",'-w','start'],check=True,capture_output=True);started=True
  def check(label,sql,want):
   got=db.one(sql);ok=got==want
   if not ok:
    try:ok=Decimal(got)==Decimal(want)
    except(InvalidOperation,ValueError):pass
   checks.append(dict(check=label,actual=got,expected=want,ok=ok));print(('PASS ' if ok else 'FAIL ')+label,flush=True)
   if not ok:raise AssertionError(checks[-1])
  db.run('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE SCHEMA auth;CREATE SCHEMA extensions;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
   CREATE TABLE ca_promo_play_through_settings(id boolean,enforced_from timestamptz);
   INSERT INTO ca_promo_play_through_settings VALUES(true,clock_timestamp()-interval '1 day');
   CREATE TABLE ca_promo_play_through_grants(id uuid PRIMARY KEY,club_id uuid,user_id uuid,granted_at timestamptz);
   CREATE TABLE ca_promo_cash_hand_clocks(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,accepted_at timestamptz,profit_capture_version smallint);
   CREATE TABLE ca_promo_profit_cash_investment(hand_id uuid,grant_id uuid,club_id uuid,user_id uuid,eligible_contribution numeric,total_contribution numeric);
   CREATE TABLE bbj_pools(id uuid PRIMARY KEY,main_balance numeric,backup_balance numeric,total_paid_out numeric,updated_at timestamptz);
   CREATE TABLE bbj_payouts(id uuid PRIMARY KEY,pool_id uuid,table_id uuid,hand_id uuid,hand_number bigint,kind text,created_at timestamptz DEFAULT now(),metadata jsonb);
   CREATE TABLE bbj_payout_recipients(payout_id uuid,user_id uuid,amount numeric,PRIMARY KEY(payout_id,user_id));
   CREATE TABLE bbj_unclaimed_shares(payout_id uuid,pool_id uuid,table_id uuid,user_id uuid,amount numeric,reason text,paid_at timestamptz,paid_note text,PRIMARY KEY(payout_id,user_id));
   CREATE TABLE wallet_credit_idempotency(key text PRIMARY KEY,user_id uuid,amount numeric);
   CREATE TABLE table_seats(table_id uuid,user_id uuid,club_id uuid,stack numeric,left_at timestamptz);
   CREATE TABLE club_members(club_id uuid,user_id uuid,chip_balance numeric,updated_at timestamptz,PRIMARY KEY(club_id,user_id));
   CREATE TABLE rake_attributions(id uuid DEFAULT gen_random_uuid(),hand_id uuid,player_id uuid,club_id uuid,created_at timestamptz DEFAULT now());
   CREATE TABLE cash_participant_funding_receipts(id uuid,operation_kind text,table_id uuid,account_entity_id uuid,funding_club_id uuid,seat_joined_at timestamptz,recorded_at timestamptz);
   CREATE TABLE chip_transactions(club_id uuid,from_user_id uuid,to_user_id uuid,amount numeric,transaction_type text,notes text,balance_after numeric,table_id uuid);
   CREATE TABLE tables(id uuid,game_variant text,game_type text);
   CREATE TABLE hand_history(id uuid,game_variant text);
   CREATE TABLE bbj_recipient_reporting_owners(payout_id uuid,user_id uuid,club_id uuid,game_variant text,source text);
   -- Explicit test-only ledger/signal adapters; no financial journal claim.
   CREATE FUNCTION fn_ca_declare_ledger(text,text,uuid,uuid,text,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
   CREATE FUNCTION fn_ensure_club_wallet(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
   CREATE FUNCTION fn_publish_member_record_user(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
   CREATE SCHEMA fixture_only;CREATE TABLE fixture_only.calls(source_kind text,source_id uuid,grant_id uuid,club_id uuid,user_id uuid,kind text,entity_id uuid,amount numeric,PRIMARY KEY(source_kind,source_id,grant_id));
   CREATE FUNCTION fn_ca_promo_profit_credit_owned(text,uuid,uuid,uuid,uuid,text,uuid,numeric) RETURNS numeric LANGUAGE plpgsql AS $$
   BEGIN IF current_setting('fixture.fail_credit',true)='yes' THEN RAISE EXCEPTION 'fixture_constructor_fault';END IF;
   INSERT INTO fixture_only.calls VALUES($1,$2,$3,$4,$5,$6,$7,$8);RETURN $8;END$$;
  ''')
  db.run(owner['definition']+';')
  check('actual captured recipient MD5 before patch',"SELECT md5(pg_get_functiondef('bbj_credit_one_recipient(uuid,uuid,uuid,numeric,boolean)'::regprocedure))",owner['md5'])
  if not args.baseline:db.run(source)
  def source(kind='main',amount=100,parts=(25,25),total=100,version=1,onfelt=True,member=True,handlink=True):
   h,t,p,pool=uid(),uid(),uid(),uid();gifts=[]
   db.run(f"INSERT INTO tables VALUES('{t}','nlh','nlh');INSERT INTO bbj_pools VALUES('{pool}',1000,1000,100,now());INSERT INTO bbj_payouts VALUES('{p}','{pool}','{t}',"+(f"'{h}'" if handlink else 'NULL')+f",1,'{kind}',now(),'{{}}');INSERT INTO ca_promo_cash_hand_clocks VALUES('{h}','{t}',1,now(),"+('NULL' if version is None else str(version))+f");INSERT INTO rake_attributions(hand_id,player_id,club_id) VALUES('{h}','{A}','{C}');")
   db.run(f"INSERT INTO cash_participant_funding_receipts VALUES(gen_random_uuid(),'buyin','{t}','{A}','{C}',now()-interval '1 hour',now())")
   for n,part in enumerate(parts):
    g=uid();gifts.append(g)
    db.run(f"INSERT INTO ca_promo_play_through_grants VALUES('{g}','{C}','{A}',now()+interval '{n} second');INSERT INTO ca_promo_profit_cash_investment VALUES('{h}','{g}','{C}','{A}',{part},{total});")
   if member:db.run(f"INSERT INTO club_members VALUES('{C}','{A}',100,now()) ON CONFLICT DO NOTHING")
   if onfelt:db.run(f"INSERT INTO table_seats VALUES('{t}','{A}','{C}',0,NULL)")
   return h,t,p,pool,gifts
  def credit(s,amount=100,seated=True):return f"SELECT bbj_credit_one_recipient('{s[2]}','{s[1]}','{A}',{amount},{str(seated).lower()})"
  s=source();check('original main seat credit succeeds',credit(s),'t')
  check('mixed original investment restricts exactly half actual payment',f"SELECT sum(amount) FROM fixture_only.calls WHERE source_id='{s[2]}'",'50.00000000000000000000')
  check('actual original seat receives full payment',f"SELECT stack FROM table_seats WHERE table_id='{s[1]}'",'100')
  check('replay does not repay',credit(s),'f')
  check('replay does not remint W',f"SELECT count(*) FROM fixture_only.calls WHERE source_id='{s[2]}'",'2')
  s=source('mini',onfelt=False,handlink=False);check('mini departed recipient uses original wallet path',credit(s,seated=False),'t')
  check('mini W binds actual destination wallet',f"SELECT count(*) FROM fixture_only.calls WHERE source_id='{s[2]}' AND kind='player_wallet' AND entity_id='{A}' AND club_id='{C}'",'2')
  s=source();db.run(f"UPDATE table_seats SET club_id=NULL WHERE table_id='{s[1]}'")
  check('legacy NULL seat club uses only original reporting funding destination',credit(s),'t')
  check('legacy destination never changes accepted earning fraction',f"SELECT sum(amount) FROM fixture_only.calls WHERE source_id='{s[2]}' AND club_id='{C}'",'50')
  s=source(parts=(),total=0);check('zero own investment table share still pays',credit(s),'t')
  check('complete empty investment creates no guessed W',f"SELECT count(*) FROM fixture_only.calls WHERE source_id='{s[2]}'",'0')
  s=source(parts=(1,1,1),total=3);check('one-cent payout succeeds',credit(s,.01),'t')
  check('one-cent sum conserved across three original gifts',f"SELECT sum(amount) FROM fixture_only.calls WHERE source_id='{s[2]}'",'0.01000000000000000000')
  check('fractional tie goes to oldest original gift',f"SELECT grant_id::text FROM fixture_only.calls WHERE source_id='{s[2]}'",s[4][0])
  s=source(version=None);bad=db.run(credit(s),check=False)
  check('unknown source refuses before original money effect',f"SELECT count(*) FROM bbj_payout_recipients WHERE payout_id='{s[2]}'",'0')
  assert bad.returncode and 'original_bbj_winnings_source_incomplete' in bad.stderr
  for busy in ['grant','seat','wallet']:
   s=source(onfelt=busy!='wallet')
   lock_sql=(f"SELECT id FROM ca_promo_play_through_grants WHERE id='{s[4][0]}' FOR UPDATE" if busy=='grant' else
             f"SELECT stack FROM table_seats WHERE table_id='{s[1]}' AND user_id='{A}' FOR UPDATE" if busy=='seat' else
             f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}' FOR UPDATE")
   destination=(f"SELECT stack FROM table_seats WHERE table_id='{s[1]}'" if busy!='wallet' else f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'")
   before=db.one(destination)
   held=subprocess.Popen([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',d,'-p','54442','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
   try:
    held.stdin.write("BEGIN;"+lock_sql+";SELECT 'READY';\n");held.stdin.flush()
    while True:
     line=held.stdout.readline()
     if line.strip()=='READY':break
     if not line:raise RuntimeError(held.stderr.read())
    bad=db.run("SET lock_timeout='200ms';SET statement_timeout='2s';"+credit(s,seated=busy!='wallet'),check=False)
    assert bad.returncode and 'could not obtain lock' in bad.stderr,bad.stderr
    check('busy original '+busy+' refuses without taking destination money',destination,before)
    check('busy original '+busy+' retains unpaid intent',f"SELECT count(*) FROM bbj_payout_recipients WHERE payout_id='{s[2]}'",'0')
   finally:
    held.stdin.write('ROLLBACK;\n\\q\n');held.stdin.flush();held.communicate(timeout=5)
    if held.returncode:raise AssertionError('held original '+busy+' fixture failed')
   check('same original intent succeeds after '+busy+' owner finishes',credit(s,seated=busy!='wallet'),'t')
  s=source();bad=db.run("SET fixture.fail_credit='yes';"+credit(s),check=False)
  assert bad.returncode and 'fixture_constructor_fault' in bad.stderr
  check('constructor fault rolls back original seat and recipient claim',f"SELECT stack||':'||(SELECT count(*) FROM bbj_payout_recipients WHERE payout_id='{s[2]}') FROM table_seats WHERE table_id='{s[1]}'",'0:0')
  # Park after dropping ONLY this isolated recipient's membership; the source
  # vector and original debt remain durable until the real destination exists.
  db.run(f"DELETE FROM club_members WHERE club_id='{C}' AND user_id='{A}'")
  s=source(onfelt=False,member=False);check('original missing-wallet route parks without credit',credit(s,seated=False),'f')
  check('parked promise creates no W custody/phase call',f"SELECT count(*) FROM fixture_only.calls WHERE source_id='{s[2]}'",'0')
  check('park returns original funding once',f"SELECT main_balance FROM bbj_pools WHERE id='{s[3]}'",'1100')
  check('park replay stays unpaid',credit(s,seated=False),'f')
  check('park replay cannot return funding twice',f"SELECT main_balance FROM bbj_pools WHERE id='{s[3]}'",'1100')
  db.run(f"INSERT INTO club_members VALUES('{C}','{A}',17,now());INSERT INTO ca_promo_play_through_grants VALUES('{uid()}','{C}','{A}',now()+interval '1 hour');DELETE FROM hand_history")
  check('park redeem pays actual original recipient',credit(s,seated=False),'t')
  check('late BBJ keeps old accepted investment despite later own funds/gift/raw pruning',f"SELECT sum(amount) FROM fixture_only.calls WHERE source_id='{s[2]}'",'50.00000000000000000000')
  check('redeem reclaims original funding exactly once',f"SELECT main_balance FROM bbj_pools WHERE id='{s[3]}'",'1000')
  s=source(version=None);db.run(f"UPDATE bbj_payouts SET created_at=now()-interval '2 days' WHERE id='{s[2]}'")
  check('historical pre-programme payout remains payable',credit(s),'t')
  check('historical payout creates no retroactive lock',f"SELECT count(*) FROM fixture_only.calls WHERE source_id='{s[2]}'",'0')
 finally:
  (OUT/'RESULTS.json').write_text(json.dumps({'passed':all(c['ok'] for c in checks),'checks':checks,'draft_sha256':hashlib.sha256(draft.read_bytes()).hexdigest(),'original_owner_md5':owner['md5'],'limits':__doc__},indent=2)+'\n')
  if started:subprocess.run([PG/'pg_ctl','-D',Path(d)/'data','-m','immediate','stop'],capture_output=True)

# The existing producer proof remains finite; its maintained entrypoint also
# requires the original main bank/real-constructor financial closure.
financial_output=OUT/'financial'
financial_command=[sys.executable,str(ROOT/'scripts/ci/test-promo-profit-bbj-financial.py'),'--output',str(financial_output),'--pg-bin',str(PG)]
if args.profit_source is not None:financial_command+=['--profit-source',str(args.profit_source)]
financial_process=subprocess.run(financial_command,check=False)
financial_report_path=financial_output/'RESULTS.json'
financial_report=json.loads(financial_report_path.read_text()) if financial_report_path.exists() else {}
producer_report=json.loads((OUT/'RESULTS.json').read_text())
financial_status=financial_report.get('status','unknown')
producer_report['financial']={'status':financial_status,'report':'financial/RESULTS.json'}
producer_report['passed']=producer_report['passed'] and financial_process.returncode==0 and financial_status=='passed'
(OUT/'RESULTS.json').write_text(json.dumps(producer_report,indent=2)+'\n')
if not producer_report['passed']:raise RuntimeError('Actual BBJ bank qualification did not pass; see '+str(financial_report_path))
