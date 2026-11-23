#!/usr/bin/env python3
"""Native original FIFO meter + actual notification bridge, isolated PostgreSQL only."""
import argparse, importlib.util, json, os, re, subprocess, tempfile, time, hashlib, uuid
from contextlib import contextmanager
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('promo_notice_base',ROOT/'scripts/ci/test-promo-play-through.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
C,A=base.CLUB,base.ALICE
MIG=ROOT/'supabase/migrations/20261116163759_promo_grant_notices_progress_pushes_and_digest_share_origina.sql'
def function(source,name):
 m=re.search(r'CREATE(?: OR REPLACE)? FUNCTION public\.'+name+r'\(.*?\bAS (\$\w*\$).*?\1\s*;',source,re.S)
 if not m:raise AssertionError('missing actual function '+name)
 return m.group(0)
EXTRA="""
CREATE TABLE profiles(id uuid PRIMARY KEY);
INSERT INTO profiles VALUES('{A}'),('{B}'),('{CARL}');
ALTER TABLE rake_records ADD COLUMN source text;
ALTER TABLE rake_attributions ADD COLUMN hand_id uuid;
CREATE TABLE ca_promo_cash_hand_clocks(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,accepted_at timestamptz);
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,committed_at timestamptz);
ALTER TABLE accounting_tournament_fee_sources ADD COLUMN rake_record_id uuid,ADD COLUMN source_charge_ledger_id uuid;
CREATE TABLE tournament_refund_entitlements(id uuid PRIMARY KEY,source_ledger_id uuid UNIQUE,tournament_id uuid,refund_wallet_club_id uuid,user_id uuid,refund_fee numeric);
CREATE TABLE tournament_refund_tranches(entitlement_id uuid,tournament_id uuid,user_id uuid,source_wallet_club_id uuid,refund_fee numeric);
CREATE TABLE tournament_unregistration_receipts(tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
CREATE TABLE tournament_cancellation_receipts(tournament_id uuid,total_rake_after numeric,fees_reversed numeric,total_rake_before numeric,fee_reversal_ids uuid[]);
CREATE TABLE ca_promo_principal_custody(grant_id uuid,amount numeric);
CREATE TABLE ca_promo_principal_return_receipts(grant_id uuid,reason text,amount numeric,created_at timestamptz);
CREATE TABLE ca_promo_integrity_source_grants(hand_id uuid,grant_id uuid,club_id uuid,user_id uuid,funded_from_type text,funded_from_id uuid,amount numeric);
CREATE INDEX ON rake_attributions(player_id,created_at DESC);
CREATE INDEX ON accounting_tournament_fee_sources(club_id,player_id,charged_at);
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,type text,title text,message text,link text,action_url text,data jsonb,actor_id uuid,created_at timestamptz DEFAULT now());
CREATE TABLE push_outbox(recipient_user_id uuid,title text,body text,url text,event text,tag text,status text,failure_reason text,related_entity_id uuid,accounting_notification_id uuid);
CREATE TABLE accounting_invoice_deliveries(invoice_id uuid,recipient_id uuid,delivery_mode text,conversation_id uuid,message_id uuid,notification_id uuid);
CREATE TABLE settlement_invoices(id uuid,invoice_number text,net_amount numeric,invoice_type text);
CREATE TABLE social_messages(id uuid,conversation_id uuid,message_type text,media_metadata jsonb);
CREATE TABLE social_conversation_participants(conversation_id uuid,user_id uuid);
CREATE TABLE sp_daily_metrics(day date,metrics jsonb,computed_at timestamptz,compute_ms numeric);
CREATE TABLE ledger_reconcile_log(run_date date DEFAULT current_date,entity_type text,entity_id uuid,ledger_balance numeric,stored_balance numeric,severity text,metadata jsonb);
ALTER TABLE ledger_reconcile_log ADD CONSTRAINT ledger_reconcile_log_entity_type_check CHECK(entity_type IN('player_wallet','club_treasury','agent_wallet','frozen_wallets_pool','chip_circulation','seat_stack_exit','cashout_escrow_stuck','negative_balance','over_claimed_send','insurance_bank','insurance_offer_unresolved','bomb_award_ledger_gap','rake_law'));
-- Incident delivery is a test-only storage adapter, never a financial writer.
CREATE TABLE test_promo_incidents(id uuid DEFAULT gen_random_uuid(),classification text,entity_id uuid,expected numeric,actual numeric);
CREATE FUNCTION fn_ca_raise_drift_incident(p_source text,p_classification text,p_severity text,p_dedupe_key text,p_discrepancy numeric,p_expected numeric,p_actual numeric,p_layer text,p_entity_type text,p_entity_id uuid,p_club_id uuid,p_suspected_cause text,p_metadata jsonb)
RETURNS uuid LANGUAGE sql AS $$INSERT INTO test_promo_incidents(classification,entity_id,expected,actual) VALUES(p_classification,p_entity_id,p_expected,p_actual) RETURNING id$$;
"""
def verify_cashout_only_notices(db,check,inputs_path):
 migration=ROOT/'supabase/migrations/20261118004310_fee_sources_do_not_scan_promo_history_for_notices.sql'
 sql=migration.read_text()
 inputs=json.loads(inputs_path.read_text())
 retirement=ROOT/'supabase/migrations/20261118004309_fee_notices_stop_reading_promo_history.sql'
 retire_sql=retirement.read_text()
 inputs['fee_notice_retirement_sha256']=hashlib.sha256(retire_sql.encode()).hexdigest()
 inputs['fee_notice_removal_sha256']=hashlib.sha256(sql.encode()).hexdigest()
 inputs_path.write_text(json.dumps(inputs,indent=2)+'\n')
 # The maintained cold removal must reject the original still-active observer.
 early=db.run(sql,check=False)
 check('physical removal refuses before its qualified ordinary retirement',
       early.returncode!=0 and 'promo fee notice retirement has not been installed' in early.stderr,True)
 db.run('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])')
 db.run(retire_sql)
 retirement_proof=next(line.removeprefix('-- @live-proof: ') for line in retire_sql.splitlines() if line.startswith('-- @live-proof: '))
 check('ordinary source retirement preserves its private trigger and exact owner',
       db.one("SELECT ("+retirement_proof+") AND NOT has_function_privilege('authenticated','public.fn_ca_promo_fee_notice()','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_promo_fee_notice()','EXECUTE') AND NOT has_function_privilege('service_role','public.fn_ca_promo_fee_notice()','EXECUTE')"),'t')

 member,charge,entitlement,accounting_id=(str(uuid.uuid4()) for _ in range(4))
 db.run(f"INSERT INTO profiles VALUES('{member}');INSERT INTO club_members VALUES('{C}','{member}',100,'member')")
 grant=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{member}',25,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
 def cash_fee(hand,table,amount):
  return f"INSERT INTO ca_promo_cash_hand_clocks VALUES('{hand}','{table}',1,clock_timestamp()) ON CONFLICT(hand_id) DO NOTHING; INSERT INTO rake_attributions(id,hand_id,player_id,club_id,rake_amount) VALUES('{hand}','{hand}','{member}','{C}',{amount}) ON CONFLICT(id) DO NOTHING;"
 # Cash and Lightning attributions reach the same relation with different
 # accepted hand and table identities. Entry tests also retain original charge
 # and entitlement identity, so later accounting recognition cannot count twice.
 classic=cash_fee(str(uuid.uuid4()),str(uuid.uuid4()),25)
 lightning=cash_fee(str(uuid.uuid4()),str(uuid.uuid4()),25)
 tournament=f"INSERT INTO accounting_tournament_fee_sources(id,tournament_id,player_id,club_id,rake_credit) VALUES('{accounting_id}','{base.TOUR_A}','{member}','{C}',20) ON CONFLICT(id) DO NOTHING;"
 paid=f"INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{charge}','player_wallet','{member}','prize_liability','{base.TOUR_B}',30,'tournament_buyin','{C}') ON CONFLICT(id) DO NOTHING; INSERT INTO tournament_refund_entitlements VALUES('{entitlement}','{charge}','{base.TOUR_B}','{C}','{member}',30) ON CONFLICT(id) DO NOTHING; INSERT INTO ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id) VALUES('{charge}','{entitlement}',30,0,30,0,'{C}','{member}') ON CONFLICT(charge_ledger_id) DO NOTHING;"
 def reads():
  return db.one("SELECT COALESCE(sum(calls),0) FROM pg_stat_user_functions WHERE funcid IN ('public.fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure,'public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure)")
 db.run('SELECT pg_stat_reset()')
 for source in (classic,lightning,tournament,paid):
  db.run(source);db.run(source)
 check('all four positive original fees reached the retired callback exactly once',
       db.one("SELECT calls FROM pg_stat_user_functions WHERE funcid='public.fn_ca_promo_fee_notice()'::regprocedure"),'4')
 check('open grant fee commits and retries make zero fee-history calls',reads(),'0')
 check('optional callback changes no principal or winnings entitlement',
       db.one(f"SELECT g.closed_at IS NULL AND g.remaining=25 AND w.unlocked_at IS NULL FROM ca_promo_play_through_grants g JOIN ca_promo_profit_gates w ON w.grant_id=g.id WHERE g.id='{grant}'"),'t')
 check('no optional threshold notification or push follows a fee',db.one(f"SELECT count(*) FROM notifications WHERE data->>'grant_id'='{grant}' AND data->>'milestone' IN ('half','near')"),'0')
 check('on-demand fee summary counts each cash and entry fee once',
       db.one(f"SELECT sum(fee_credit) FROM fn_ca_promo_fee_events('{C}','{member}',(SELECT granted_at FROM ca_promo_play_through_grants WHERE id='{grant}'),'infinity')"),'100')
 check('on-demand principal meter reaches exact original threshold',db.one(f"SELECT state FROM fn_ca_promo_play_through_state('{C}','{member}') WHERE grant_id='{grant}'"),'met_pending')
 db.run(f"SELECT fn_ca_promo_play_through_settle('{C}','{member}');SELECT fn_ca_promo_play_through_settle('{C}','{member}')")
 check('authoritative final transition still sends one completion notification and push',db.one(f"SELECT count(*)=1 AND count(o.related_entity_id)=1 FROM notifications n LEFT JOIN push_outbox o ON o.related_entity_id=n.id WHERE n.data->>'grant_id'='{grant}' AND n.data->>'milestone'='unlocked'"),'t')
 db.run('SELECT pg_stat_reset()')
 db.run(cash_fee(str(uuid.uuid4()),str(uuid.uuid4()),5))
 check('a later terminal-grant fee makes zero history calls',reads(),'0')
 # Drift must refuse before losing a single producer, including the other tables.
 db.run('ALTER TABLE public.rake_attributions DISABLE TRIGGER ca_promo_fee_notice')
 refusal=db.run(sql,check=False)
 check('changed fee notice binding refuses the entire migration',
       refusal.returncode!=0 and 'promo fee notice trigger changed' in refusal.stderr,True)
 check('refused migration preserves all three original triggers',
       db.one("SELECT count(*) FROM pg_trigger WHERE tgfoid='public.fn_ca_promo_fee_notice()'::regprocedure"),'3')
 db.run('ALTER TABLE public.rake_attributions ENABLE TRIGGER ca_promo_fee_notice')
 db.run(sql)
 proof=next(line.removeprefix('-- @live-proof: ') for line in sql.splitlines() if line.startswith('-- @live-proof: '))
 check('no original fee source dispatches an optional promo notice',db.one('SELECT '+proof),'t')
 check('a missing observer without its exact successor receipt is never certified',db.one('SELECT '+retirement_proof),'f')
 db.run("INSERT INTO supabase_migrations.schema_migrations VALUES('20261118004310','fee_sources_do_not_scan_promo_history_for_notices',ARRAY['incorrect bytes'])")
 check('wrong successor bytes cannot certify the retired observer',db.one('SELECT '+retirement_proof),'f')
 db.run("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY[$receipt$"+sql+"$receipt$] WHERE version='20261118004310'")
 check('exact recorded cold removal proves the superseded ordinary postimage',db.one('SELECT '+retirement_proof),'t')


 db.run('SELECT pg_stat_reset()')
 db.run(cash_fee(str(uuid.uuid4()),str(uuid.uuid4()),5))
 check('cold removal retains original fee admission with zero history calls',reads(),'0')


def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--custody-migration',type=Path,default=ROOT/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql');p.add_argument('--ticket-migration',type=Path,default=ROOT/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_keep_entry_source.sql');p.add_argument('--integrity-migration',type=Path,default=ROOT/'supabase/migrations/20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql');p.add_argument('--profit-migration',type=Path,default=ROOT/'supabase/migrations/20261116190221_promo_winnings_retain_original_source_until_two_times_paid_f.sql');args=p.parse_args()
 if not args.profit_migration.exists():raise SystemExit('original profit earned transition prerequisite unavailable; provide --profit-migration')
 if not args.ticket_migration.exists():raise SystemExit('original paid fee source prerequisite unavailable; provide --ticket-migration')
 if not args.integrity_migration.exists():
  raise SystemExit('integrity source prerequisite unavailable; provide --integrity-migration')
 if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
  raise SystemExit('external TMPDIR required')
 if not args.custody_migration.exists():raise SystemExit('custody source prerequisite unavailable; provide --custody-migration')
 args.output.mkdir(parents=True,exist_ok=False)
 results=[];pg=Path(base.pg_bin());port=54427
 def check(label,actual,expected):
  ok=actual==expected;results.append(dict(check=label,ok=ok,actual=actual,expected=expected));print(('PASS ' if ok else 'FAIL ')+label,flush=True)
  if not ok:raise AssertionError((label,actual,expected))
 with tempfile.TemporaryDirectory(prefix='pn-') as directory:
  d=Path(directory);data=d/'data';started=False;db=base.Db(directory,port,'promo_notices')
  try:
   subprocess.run([str(pg/'initdb'),'-D',str(data),'-U','postgres','-A','trust','--no-locale'],check=True,capture_output=True)
   subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'-l',str(d/'pg.log'),'-o',f"-F -k {directory} -p {port} -c listen_addresses='' -c track_functions=all",'-w','start'],check=True,capture_output=True);started=True
   db.run('CREATE DATABASE promo_notices',db='postgres');db.run(base.STUB)
   # Freeze the product's last closed Chicago day once. PostgreSQL may run
   # in UTC, where current_date crosses midnight several hours earlier.
   fixture_clock=db.json("SELECT json_build_object('database_timezone',current_setting('TimeZone'),'utc_day',(clock_timestamp() AT TIME ZONE 'UTC')::date,'chicago_day',(clock_timestamp() AT TIME ZONE 'America/Chicago')::date,'closed_day',(clock_timestamp() AT TIME ZONE 'America/Chicago')::date-1)")
   closed_day=fixture_clock['closed_day']
   for f in base.MIGRATIONS:db.run(Path(f).read_text())
   integrity=args.integrity_migration.read_text()
   for table in ['ca_promo_integrity_cases','ca_promo_integrity_releases','ca_promo_integrity_custody']:
    ddl=re.search(r'CREATE TABLE public\.'+table+r' \(.*?\n\);',integrity,re.S).group(0)
    db.run(ddl)
   db.run(EXTRA.replace('{A}',A).replace('{B}',base.BOB).replace('{CARL}',base.CARL))
   for name in ['fn_ca_promo_integrity_move','fn_ca_promo_integrity_release']:
    db.run(function(integrity,name))
   custody=args.custody_migration.read_text()
   (args.output/'INPUTS.json').write_text(json.dumps({'custody_migration_sha256':hashlib.sha256(custody.encode()).hexdigest(),'custody_components_sha256':{name:hashlib.sha256(function(custody,name).encode()).hexdigest() for name in ['fn_ca_promo_cash_fee_clock_missing','fn_ca_promo_fee_events','fn_ca_promo_play_through_state']},'integrity_migration_sha256':hashlib.sha256(integrity.encode()).hexdigest(),'integrity_components_sha256':{name:hashlib.sha256(function(integrity,name).encode()).hexdigest() for name in ['fn_ca_promo_integrity_move','fn_ca_promo_integrity_release']},'notices_migration_sha256':hashlib.sha256(MIG.read_bytes()).hexdigest(),'owners_sha256':hashlib.sha256((ROOT/'tests/fixtures/promo-notices/owners.sql').read_bytes()).hexdigest(),'fixture_business_clock':fixture_clock},indent=2)+'\n')
   for name in ['fn_ca_promo_cash_fee_clock_missing','fn_ca_promo_fee_events','fn_ca_promo_play_through_state']:db.run(function(custody,name))
   ticket=args.ticket_migration.read_text()
   paid_ddl=re.search(r'CREATE TABLE public\.ca_promo_event_fee_consumption_receipts \(.*?\n\);',ticket,re.S).group(0)
   paid_index=re.search(r'CREATE INDEX ca_promo_original_paid_fee_member.*?;',ticket,re.S).group(0)
   paid_reader=function(ticket,'fn_ca_promo_original_entry_fee_events')
   meter_patch=re.search(r'DO \$entry_meter\$.*?END \$entry_meter\$;',ticket,re.S).group(0)
   db.run(paid_ddl);db.run(paid_index);db.run(paid_reader);db.run(meter_patch)
   inputs=json.loads((args.output/'INPUTS.json').read_text());inputs.update({'ticket_migration_sha256':hashlib.sha256(ticket.encode()).hexdigest(),'paid_entry_components_sha256':{'receipt':hashlib.sha256(paid_ddl.encode()).hexdigest(),'index':hashlib.sha256(paid_index.encode()).hexdigest(),'reader':hashlib.sha256(paid_reader.encode()).hexdigest(),'meter_patch':hashlib.sha256(meter_patch.encode()).hexdigest()}});(args.output/'INPUTS.json').write_text(json.dumps(inputs,indent=2)+'\n')
   db.run((ROOT/'tests/fixtures/promo-notices/owners.sql').read_text())
   db.run((ROOT/'tests/fixtures/promo-notices/incident.sql').read_text())
   db.run('CREATE TRIGGER actual_incident_bridge AFTER INSERT ON ledger_reconcile_log FOR EACH ROW EXECUTE FUNCTION fn_ca_reconcile_log_to_incident()')
   db.run("CREATE TRIGGER actual_push_bridge AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fn_mirror_notification_to_push_outbox()")
   db.run(MIG.read_text())
   refund_notice_mig=ROOT/'supabase/migrations/20261123083752_a_refunded_entry_notifies_the_player_and_successor_grants_st.sql'
   rn_sql=refund_notice_mig.read_text()
   rn_digest_boundary='-- PROMO GRANT NOTICE AND DIGEST SECTION.'
   db.run("BEGIN;SET LOCAL lock_timeout='2s';\n"+rn_sql[rn_sql.index(rn_digest_boundary):])
   rn_table_start=rn_sql.index('CREATE TABLE public.ca_promo_refund_notices')
   rn_fn_end=rn_sql.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_emit_refund_notice')
   rn_fn_end=rn_sql.index(';',rn_fn_end)+1
   db.run(rn_sql[rn_table_start:rn_fn_end])
   db.run("CREATE EXTENSION IF NOT EXISTS plpgsql_check;DO $$DECLARE f text;n int;BEGIN FOR f IN SELECT unnest(ARRAY['public.fn_ca_promo_daily_digest(date)','public.fn_ca_promo_emit_refund_notice(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric)']) LOOP SELECT count(*) INTO n FROM plpgsql_check_function_tb(f::regprocedure) c WHERE c.level='error';IF n<>0 THEN RAISE EXCEPTION 'plpgsql_check found % error(s) in %',n,f;END IF;END LOOP;END$$;")
   proof=next(line.split('-- @live-proof: ',1)[1] for line in MIG.read_text().splitlines() if line.startswith('-- @live-proof: '))
   check('declared live proof validates all source producers and observer storage',db.one('SELECT '+proof),'t')
   check('private notices cannot be called by browser',db.one("SELECT has_function_privilege('authenticated','fn_ca_promo_emit_notice(uuid,text,numeric,numeric,numeric)','EXECUTE')"),'f')
   db.run(f"UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second'; UPDATE club_members SET role='owner' WHERE club_id='{C}' AND user_id='{A}';")
   def grant(amount=50):
    return db.one(f"SELECT public.fn_ca_promo_play_through_record_grant('{C}','{A}',{amount},'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{base.BOB}',NULL)")
   def fee(n):db.run(f"WITH clock AS(INSERT INTO ca_promo_cash_hand_clocks VALUES(gen_random_uuid(),'{C}',1,clock_timestamp()) RETURNING hand_id) INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount) SELECT hand_id,'{A}','{C}',{n} FROM clock")
   def milestones():return db.one("SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones")
   g=grant();check('received exactly once',milestones(),'received')
   check('grant notice opens its original club wallet',db.one(f"SELECT link FROM notifications WHERE data->>'grant_id'='{g}'"),f'/hub/club-arena/wallet?club={C}')
   check('actual original bridge creates durable push',db.one("SELECT count(*) FROM push_outbox WHERE event='promo_play_through'"),'1')
   fee(99);check('below halfway does not notify',milestones(),'received')
   fee(1);check('actual cash fee crosses halfway',milestones(),'received,half')
   check('halfway notice names original principal rather than claiming profit completion',db.one(f"SELECT title FROM notifications WHERE data->>'grant_id'='{g}' AND data->>'milestone'='half'"),'Original Promo Principal Halfway')
   fee(80);check('actual cash fee crosses ninety percent',milestones(),'received,half,near')
   fee(20);check('met_pending is not represented as completed unlock',milestones(),'received,half,near')
   check('notice reads do not close grant',db.one(f"SELECT closed_at IS NULL AND remaining=50 FROM ca_promo_play_through_grants WHERE id='{g}'"),'t')
   db.run(f"UPDATE ca_promo_play_through_grants SET remaining=20 WHERE id='{g}'; SELECT fn_ca_promo_play_through_settle('{C}','{A}')")
   check('original final closure emits unlock',milestones(),'received,half,near,unlocked')
   check('unlock reports actual surviving principal',db.one(f"SELECT principal_amount FROM ca_promo_notice_milestones WHERE grant_id='{g}' AND milestone='unlocked'"),'20')
   fee(5);check('late fees cannot duplicate completed unlock',db.one("SELECT count(*) FROM notifications"),'4')
   db.run("UPDATE ca_promo_notice_milestones SET principal_amount=0",check=False)
   check('milestone is immutable',db.one(f"SELECT principal_amount FROM ca_promo_notice_milestones WHERE grant_id='{g}' AND milestone='unlocked'"),'20')
   # A single large fee earns only the highest progress message.
   g2=grant();fee(180)
   check('jump to ninety emits one progress notice',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{g2}'"),'received,near')
   # Exact FIFO meter is read once for this new fee event, across all grants.
   db.run(f"INSERT INTO rake_attributions(player_id,club_id,rake_amount,created_at) SELECT '{A}','{C}',0,clock_timestamp()-interval '1 day' FROM generate_series(1,30000)")
   db.run('SELECT pg_stat_reset()');fee(1);time.sleep(.1)
   check('one meter evaluation per fee-source notice with thirty thousand rows',db.one("SELECT calls FROM pg_stat_user_functions WHERE funcid='fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure"),'1')
   (args.output/'PERFORMANCE.json').write_text(json.dumps(db.json("SELECT jsonb_build_object('source_rows',30000,'state_calls',calls,'total_ms',total_time,'self_ms',self_time,'basis','Existing production-equivalent player/time indexes; one read per fee event') FROM pg_stat_user_functions WHERE funcid='fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure"),indent=2)+'\n')
   check('fee notices never alter gross fees',db.one(f"SELECT sum(rake_amount) FROM rake_attributions WHERE player_id='{A}'"),'386')
   # The original tournament source is observed only after its full transaction.
   gb=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{base.BOB}',50,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
   tour=base.TOUR_A
   db.run(f"""DO $$DECLARE pos uuid;neg uuid;BEGIN
    INSERT INTO rake_records(tournament_id,is_tournament,rake_amount,metadata,source)
     VALUES('{tour}',true,180,jsonb_build_object('user_id','{base.BOB}'),'registration') RETURNING id INTO pos;
    INSERT INTO accounting_tournament_fee_sources(tournament_id,player_id,club_id,rake_credit,rake_record_id)
     VALUES('{tour}','{base.BOB}','{C}',180,pos);
    INSERT INTO rake_records(tournament_id,is_tournament,rake_amount,metadata,source)
     VALUES('{tour}',true,-180,jsonb_build_object('user_id','{base.BOB}','original_rake_record_id',pos),'fn_unregister_from_tournament') RETURNING id INTO neg;
    INSERT INTO tournament_unregistration_receipts VALUES('{tour}','{base.BOB}',180,ARRAY[neg],ARRAY[pos]); END$$;""")
   check('same-transaction exact entry refund creates no false progress notice',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{gb}'"),'received')
   db.run(f"INSERT INTO accounting_tournament_fee_sources(tournament_id,player_id,club_id,rake_credit) VALUES('{base.TOUR_B}','{base.BOB}','{C}',100)")
   check('recognized tournament source crosses halfway',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{gb}'"),'received,half')
   db.run(f"SELECT set_config('test.uid','{A}',false); SELECT fn_ca_promo_play_through_override('{C}','{base.BOB}','Reviewed Original Grant')")
   check('manual release retains exact digest principal without claiming earned unlock',db.one(f"SELECT milestone||':'||principal_amount FROM ca_promo_notice_milestones WHERE grant_id='{gb}' AND milestone='manual_release'"),'manual_release:50')
   check('manual override does not send earned completion notice',db.one(f"SELECT count(*) FROM ca_promo_notice_milestones WHERE grant_id='{gb}' AND milestone='unlocked'"),'0')
   check('original P support decision sends a non-earned recipient refresh',db.one(f"SELECT count(*) FROM notifications WHERE data->>'grant_id'='{gb}' AND data->>'milestone'='support_override'"),'1')
   db.run(f"INSERT INTO club_members VALUES('{C}','{base.CARL}',80,'member')")
   gc=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{base.CARL}',50,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
   concurrent=f"WITH clock AS(INSERT INTO ca_promo_cash_hand_clocks VALUES(gen_random_uuid(),'{C}',1,clock_timestamp()) RETURNING hand_id) INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount) SELECT hand_id,'{base.CARL}','{C}',100 FROM clock"
   with ThreadPoolExecutor(max_workers=2) as pool:
    for result in [pool.submit(db.run,concurrent),pool.submit(db.run,concurrent)]:result.result()
   check('concurrent qualifying source events create one milestone',db.one(f"SELECT count(*) FROM ca_promo_notice_milestones WHERE grant_id='{gc}' AND milestone='half'"),'1')
   check('concurrent sources keep both original gross fee rows',db.one(f"SELECT sum(rake_amount) FROM rake_attributions WHERE player_id='{base.CARL}'"),'200')
   # Original reviewed-release source notifies the current custody holders,
   # including an original private move; donor and past holder are not guessed.
   hc=db.one(f"INSERT INTO ca_promo_integrity_cases(hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES(gen_random_uuid(),'{C}','{A}','{C}','{base.BOB}',25,'{{}}') RETURNING id")
   db.run(f"INSERT INTO ca_promo_integrity_custody VALUES('{hc}','{C}','{base.BOB}','player_wallet','{base.BOB}',20),('{hc}','{C}','{base.BOB}','agent_wallet','{base.BOB}',5); SELECT fn_ca_promo_integrity_move('{C}','{base.BOB}','player_wallet','{base.BOB}','player_wallet','{base.CARL}',10,'{C}','{base.CARL}')")
   denied=db.json(f"SET test.uid='{base.BOB}'; SELECT fn_ca_promo_integrity_release('{hc}','Member Cannot Review Their Own Hold')")
   check('original release rejects an ordinary member',denied['success'],False)
   check('unauthorized release creates no notices',db.one(f"SELECT count(*) FROM notifications WHERE data->>'review_case_id'='{hc}'"),'0')
   released=db.json(f"SET test.uid='{A}'; SELECT fn_ca_promo_integrity_release('{hc}','Reviewed Original Accepted Hand')")
   check('original release freezes exact held amount',released['released_amount'],25)
   check('review notice reaches each exact current holder once',db.one(f"SELECT count(*) FROM notifications WHERE data->>'review_case_id'='{hc}'"),'2')
   check('moved holder receives only current position amount',db.one(f"SELECT data->>'released_amount' FROM notifications WHERE data->>'review_case_id'='{hc}' AND user_id='{base.CARL}'"),'10')
   check('review notice opens exact current holder club',db.one(f"SELECT link FROM notifications WHERE data->>'review_case_id'='{hc}' AND user_id='{base.CARL}'"),f'/hub/club-arena/wallet?club={C}')
   check('source donor receives no invented release notice',db.one(f"SELECT count(*) FROM notifications WHERE data->>'review_case_id'='{hc}' AND user_id='{A}'"),'0')
   check('review notices use actual push bridge',db.one(f"SELECT count(*) FROM push_outbox o JOIN notifications n ON n.id=o.related_entity_id WHERE n.data->>'review_case_id'='{hc}'"),'2')
   replay=db.json(f"SET test.uid='{A}'; SELECT fn_ca_promo_integrity_release('{hc}','Same Original Review')")
   check('release replay recovers immutable review receipt',replay['already_reviewed'],True)
   check('release replay cannot duplicate holder notices',db.one(f"SELECT count(*) FROM notifications WHERE data->>'review_case_id'='{hc}'"),'2')
   # Read-only conservation observer reports, never repairs, a mismatch.
   db.run(f"INSERT INTO ca_promo_principal_custody VALUES('{g2}',12)")
   check('observer leaves grant unchanged',db.one(f"SELECT remaining FROM ca_promo_play_through_grants WHERE id='{g2}'"),'50')
   check('actual nightly owner contains observer wiring',db.one("SELECT position('FROM public.ca_promo_play_through_grants g LEFT JOIN public.ca_promo_principal_custody c' in prosrc)>0 FROM pg_proc WHERE oid='reconcile_ledger_nightly()'::regprocedure"),'t')
   observer=db.one("SELECT prosrc FROM pg_proc WHERE oid='reconcile_ledger_nightly()'::regprocedure")
   statement=re.search(r"  INSERT INTO public\.ledger_reconcile_log\(entity_type,entity_id,ledger_balance,stored_balance,severity,metadata\).*?  \) p;",observer,re.S).group(0)
   db.run(statement)
   check('observer reports custody and remaining independently',db.one(f"SELECT ledger_balance||':'||stored_balance FROM ledger_reconcile_log WHERE entity_id='{g2}'"),'50:12')
   check('actual nightly observer statement reaches original incident bridge',db.one(f"SELECT classification||':'||expected||':'||actual FROM test_promo_incidents WHERE entity_id='{g2}'"),'ledger_imbalance:50:12')
   check('existing observer type constraint stays validated',db.one("SELECT convalidated FROM pg_constraint WHERE conrelid='ledger_reconcile_log'::regclass AND conname='ledger_reconcile_log_entity_type_check'"),'t')
   check('actual daily digest contains observer wiring',db.one("SELECT position('fn_ca_promo_daily_digest' in prosrc)>0 FROM pg_proc WHERE oid='fn_sp_daily_digest(date,boolean)'::regprocedure"),'t')
   # Exact original funder partition survives later grants or hierarchy changes.
   db.run(f"UPDATE ca_promo_play_through_grants SET cycle_started_at=('{closed_day}'::date::timestamp AT TIME ZONE 'America/Chicago'),granted_at=(('{closed_day}'::date+time '12:00') AT TIME ZONE 'America/Chicago') WHERE id='{g2}'; INSERT INTO ca_promo_principal_return_receipts VALUES('{g2}','expired',7,(('{closed_day}'::date+time '13:00') AT TIME ZONE 'America/Chicago'))")
   db.run(f"INSERT INTO ca_promo_integrity_cases(hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence,created_at) VALUES('{base.TOUR_A}','{C}','{A}','{C}','{base.BOB}',0,'{{}}',(('{closed_day}'::date+time '14:00') AT TIME ZONE 'America/Chicago')); INSERT INTO ca_promo_integrity_source_grants VALUES('{base.TOUR_A}','{g2}','{C}','{A}','promo_wallet','{base.BOB}',10)")
   report=db.json(f"SELECT fn_ca_promo_daily_digest('{closed_day}'::date)")
   check('digest original grant funding identity',next(x for x in report['funding_owners'] if x['expired']==7)['funded_from_id'],base.BOB)
   check('digest actual expired return amount',sum(x['expired'] for x in report['funding_owners']),7)
   check('digest flags only exact original source funder',next(x for x in report['funding_owners'] if x['funded_from_id']==base.BOB)['flagged'],1)
   check('unrelated current grants do not inherit donor flags',next(x for x in report['funding_owners'] if x['funded_from_id']==A)['flagged'],0)
   check('daily club totals retain exact given principal',report['clubs'][0]['given'],50)
   check('daily club total counts distinct cases once',report['clubs'][0]['flagged'],1)
   # Refund successor grant (20261123083752): never emits a misleading
   # "Promo Chips Received" notice and never inflates daily digest `given`.
   succ_id=str(uuid.uuid4())
   db.run(f"""INSERT INTO ca_promo_play_through_grants(
     id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,
     source_ledger_id,funded_from_type,funded_from_id,cycle_started_at,granted_at,expires_at)
     VALUES('{succ_id}','{C}','{A}',12,12,4,'club_promo','refund_successor:'||'{g2}'||':fee_refund:test',
       NULL,'promo_wallet','{base.BOB}',('{closed_day}'::date::timestamp AT TIME ZONE 'America/Chicago'),
       (('{closed_day}'::date+time '12:30') AT TIME ZONE 'America/Chicago'),
       clock_timestamp()+interval '20 days')""")
   check('refund successor emits no misleading received notice',db.one(f"SELECT count(*) FROM ca_promo_notice_milestones WHERE grant_id='{succ_id}'"),'0')
   check('refund successor creates no received notification row',db.one(f"SELECT count(*) FROM notifications WHERE data->>'grant_id'='{succ_id}'"),'0')
   report_after_succ=db.json(f"SELECT fn_ca_promo_daily_digest('{closed_day}'::date)")
   check('refund successor does not double-count daily given total',report_after_succ['clubs'][0]['given'],50)
   check('refund successor is still tracked in locked_now',report_after_succ['clubs'][0]['locked_now'],report['clubs'][0]['locked_now']+12)
   db.run(f"UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='met' WHERE id='{succ_id}'")
   check('refund successor still emits completion notice when met',db.one(f"SELECT string_agg(milestone,',') FROM ca_promo_notice_milestones WHERE grant_id='{succ_id}'"),'unlocked')
   # Refund notification emitter (20261123083752): exact wording, push bridge,
   # idempotent replay, and deleted-profile resilience.
   db.run("CREATE TABLE IF NOT EXISTS public.tournaments(id uuid PRIMARY KEY,name text)")
   ev_sat=str(uuid.uuid4())
   db.run(f"INSERT INTO public.tournaments(id,name) VALUES('{ev_sat}','Satellite Into Nightly 20K (NLH)')")
   led_w=str(uuid.uuid4())
   check('wallet refund notice emits once',db.one(f"SELECT public.fn_ca_promo_emit_refund_notice('{led_w}',gen_random_uuid(),'{A}','{C}','{ev_sat}','wallet',10,5.25,0,0,NULL)"),'t')
   check('wallet refund notice wording explains promo stays under play-through',db.one(f"SELECT type||'|'||title||'|'||message FROM notifications WHERE data->>'ledger_id'='{led_w}'"),'promo_play_through|Tournament Entry Refunded|Your 10.00 Entry To Satellite Into Nightly 20K (NLH) Was Refunded. 5.25 Of It Is Promo Chips And Stays Under Play-Through.')
   check('wallet refund notice mirrors to push outbox',db.one(f"SELECT count(*) FROM push_outbox o JOIN notifications n ON n.id=o.related_entity_id WHERE n.data->>'ledger_id'='{led_w}'"),'1')
   check('wallet refund notice replay is idempotent',db.one(f"SELECT public.fn_ca_promo_emit_refund_notice('{led_w}',gen_random_uuid(),'{A}','{C}','{ev_sat}','wallet',10,5.25,0,0,NULL)"),'f')
   check('wallet refund notice replay never duplicates notification',db.one(f"SELECT count(*) FROM notifications WHERE data->>'ledger_id'='{led_w}'"),'1')
   led_t=str(uuid.uuid4())
   check('ticket refund notice emits once',db.one(f"SELECT public.fn_ca_promo_emit_refund_notice('{led_t}',gen_random_uuid(),'{A}','{C}','{ev_sat}','ticket',20,10,0,0,20)"),'t')
   check('ticket refund notice wording explains promo on ticket',db.one(f"SELECT title||'|'||message FROM notifications WHERE data->>'ledger_id'='{led_t}'"),'Tournament Ticket Refunded|Your 20.00 Entry To Satellite Into Nightly 20K (NLH) Was Refunded As A Tournament Ticket. 10.00 Of It Is Promo Chips And Stays Under Play-Through.')
   led_cash=str(uuid.uuid4())
   check('non-promo wallet refund notice uses tournament_cash type',db.one(f"SELECT public.fn_ca_promo_emit_refund_notice('{led_cash}',gen_random_uuid(),'{A}','{C}','{ev_sat}','wallet',10,0,0,0,NULL)"),'t')
   check('non-promo wallet refund notice wording',db.one(f"SELECT type||'|'||message FROM notifications WHERE data->>'ledger_id'='{led_cash}'"),'tournament_cash|Your 10.00 Entry To Satellite Into Nightly 20K (NLH) Was Refunded To Your Wallet.')
   led_orphan=str(uuid.uuid4())
   check('deleted profile preserves refund notice receipt without throwing',db.one(f"SELECT public.fn_ca_promo_emit_refund_notice('{led_orphan}',NULL,gen_random_uuid(),'{C}','{ev_sat}','wallet',10,5,0,0,NULL)"),'f')
   check('deleted profile stores null notification_id receipt',db.one(f"SELECT notification_id IS NULL FROM ca_promo_refund_notices WHERE ledger_id='{led_orphan}'"),'t')
   @contextmanager
   def held_notice(sql):
    proc=subprocess.Popen([str(pg/'psql'),'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',directory,'-p',str(port),'-U','postgres','-d','promo_notices'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    try:
     proc.stdin.write("BEGIN; SET LOCAL statement_timeout='5s'; "+sql+"; SELECT 'NOTICE_READY';\n");proc.stdin.flush()
     while True:
      line=proc.stdout.readline()
      if line.strip()=='NOTICE_READY':break
      if not line:raise RuntimeError('held notice owner failed: '+proc.stderr.read())
     yield
     proc.stdin.write('COMMIT;\n\\q\n');proc.stdin.flush();_,error=proc.communicate(timeout=5)
     if proc.returncode:raise RuntimeError(error)
    finally:
     if proc.poll() is None:proc.kill();proc.communicate()
   def race_source(user,amount):
    return f"WITH clock AS(INSERT INTO ca_promo_cash_hand_clocks VALUES(gen_random_uuid(),'{C}',1,clock_timestamp()) RETURNING hand_id) INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount) SELECT hand_id,'{user}','{C}',{amount} FROM clock"
   for first,second,expected in [(180,100,'received,near'),(100,180,'received,half')]:
    user=db.one('SELECT gen_random_uuid()');db.run(f"INSERT INTO profiles VALUES('{user}'); INSERT INTO club_members VALUES('{C}','{user}',80,'member')")
    race_grant=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{user}',50,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
    with held_notice(race_source(user,first)+'; SET CONSTRAINTS ca_promo_fee_notice IMMEDIATE'):
     db.run(race_source(user,second))
    check(f'progress order {first} then {second} skips only busy optional notice',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{race_grant}'"),expected)
    db.run(race_source(user,1))
    check(f'progress order {first} then {second} never puts halfway after near',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{race_grant}'"),'received,near' if first==180 else 'received,half,near')
   # A valid synthetic grant row names its id before insertion so another
   # session can hold only that optional notice key. Original insert/settle
   # triggers must still persist received and actual met completion.
   user=db.one('SELECT gen_random_uuid()');forced=db.one('SELECT gen_random_uuid()')
   db.run(f"INSERT INTO profiles VALUES('{user}'); INSERT INTO club_members VALUES('{C}','{user}',80,'member')")
   with held_notice(f"SELECT pg_advisory_xact_lock(hashtextextended('ca-promo-progress-notice:'||'{forced}',0))"):
    columns=db.one("SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='ca_promo_play_through_grants'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=''")
    # Both identity clocks share one actual instant; separate volatile calls
    # can violate the original cycle-not-after-grant constraint by a microsecond.
    db.run(f"WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS at) INSERT INTO ca_promo_play_through_grants({columns}) SELECT {columns} FROM jsonb_populate_record(NULL::ca_promo_play_through_grants,(SELECT to_jsonb(g)||jsonb_build_object('id','{forced}','user_id','{user}','source_ref','{forced}','remaining',50,'closed_at',NULL,'close_reason',NULL,'granted_at',stamp.at,'cycle_started_at',stamp.at) FROM ca_promo_play_through_grants g CROSS JOIN stamp WHERE id='{g2}'))")
    db.run(race_source(user,200));db.run(f"SELECT fn_ca_promo_play_through_settle('{C}','{user}')")
   check('received and actual met completion always persist despite a busy optional progress key',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{forced}'"),'received,unlocked')
   # Original paid fees qualify immediately without a commission agreement
   # or a later accounting source. The immutable rendezvous is the event.
   db.run(f"INSERT INTO club_members VALUES('{C}','{base.CARL}',80,'member') ON CONFLICT DO NOTHING")
   paid_grant=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{base.CARL}',50,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
   def paid_fee(amount):
    charge=db.one(f"INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('player_wallet','{base.CARL}','prize_liability','{base.TOUR_A}',{amount},'tournament_buyin','{C}') RETURNING id")
    entitlement=db.one(f"INSERT INTO tournament_refund_entitlements VALUES(gen_random_uuid(),'{charge}','{base.TOUR_A}','{C}','{base.CARL}',{amount}) RETURNING id")
    db.run(f"INSERT INTO ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id) VALUES('{charge}','{entitlement}',{amount},0,{amount},0,'{C}','{base.CARL}')")
    return charge,entitlement
   first_charge,first_entitlement=paid_fee(100)
   check('paid entry without earning agreement immediately reaches halfway',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{paid_grant}'"),'received,half')
   second_charge,second_entitlement=paid_fee(80)
   check('next original paid entry immediately reaches ninety',db.one(f"SELECT string_agg(milestone,',' ORDER BY created_at) FROM ca_promo_notice_milestones WHERE grant_id='{paid_grant}'"),'received,half,near')
   check('original entry meter does not wait for canonical recognition',db.one(f"SELECT sum(fee_credit) FROM fn_ca_promo_fee_events('{C}','{base.CARL}',(SELECT granted_at FROM ca_promo_play_through_grants WHERE id='{paid_grant}'),'infinity')"),'180')
   db.run(f"INSERT INTO accounting_tournament_fee_sources(tournament_id,player_id,club_id,rake_credit,source_charge_ledger_id,charged_at) VALUES('{base.TOUR_A}','{base.CARL}','{C}',100,'{first_charge}',clock_timestamp()),('{base.TOUR_A}','{base.CARL}','{C}',80,'{second_charge}',clock_timestamp()+interval '1 hour')")
   check('late canonical source cannot credit an original paid fee twice',db.one(f"SELECT sum(fee_credit) FROM fn_ca_promo_fee_events('{C}','{base.CARL}',(SELECT granted_at FROM ca_promo_play_through_grants WHERE id='{paid_grant}'),'infinity')"),'180')
   check('late recognition outside original clock window adds no fee',db.one(f"SELECT count(*) FROM fn_ca_promo_fee_events('{C}','{base.CARL}',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '2 hours')"),'0')
   db.run(f"INSERT INTO ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id) VALUES('{first_charge}','{first_entitlement}',100,0,100,0,'{C}','{base.CARL}') ON CONFLICT DO NOTHING")
   check('original paid receipt replay and canonical recognition cannot duplicate milestones',db.one(f"SELECT count(*) FROM notifications WHERE data->>'grant_id'='{paid_grant}'"),'3')
   db.run(f"INSERT INTO tournament_refund_tranches VALUES('{first_entitlement}','{base.TOUR_A}','{base.CARL}','{C}',100)")
   check('actual canonical tranche reverses unfinished original paid fee progress',db.one(f"SELECT sum(fee_credit) FROM fn_ca_promo_fee_events('{C}','{base.CARL}',(SELECT granted_at FROM ca_promo_play_through_grants WHERE id='{paid_grant}'),'infinity')"),'80')
   check('refund never forges a completed unlock notice',db.one(f"SELECT count(*) FROM notifications WHERE data->>'grant_id'='{paid_grant}' AND data->>'milestone'='unlocked'"),'0')
   # Bounded original paid-fee lookup on the new member/clock index.
   # Synthetic load-only rows bypass producer triggers, never production.
   db.run(f"""BEGIN; SET LOCAL session_replication_role=replica;
    CREATE TEMP TABLE paid_load AS SELECT gen_random_uuid() charge,gen_random_uuid() entitlement FROM generate_series(1,30000);
    INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
     SELECT charge,'player_wallet','{base.CARL}','prize_liability','{base.TOUR_B}',1,'tournament_buyin','{C}' FROM paid_load;
    INSERT INTO tournament_refund_entitlements SELECT entitlement,charge,'{base.TOUR_B}','{C}','{base.CARL}',1 FROM paid_load;
    INSERT INTO ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id,earned_at)
     SELECT charge,entitlement,1,0,1,0,'{C}','{base.CARL}',clock_timestamp()-interval '31 days' FROM paid_load;
    COMMIT; ANALYZE ca_promo_event_fee_consumption_receipts; ANALYZE tournament_refund_entitlements;""")
   db.run('SELECT pg_stat_reset()');paid_fee(1);time.sleep(.1)
   check('one meter evaluation for original paid notice with thirty thousand historical entries',db.one("SELECT calls FROM pg_stat_user_functions WHERE funcid='fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure"),'1')
   body=paid_reader.split('AS $$',1)[1].rsplit('$$',1)[0].strip().rstrip(';')
   bounds=db.json("SELECT jsonb_build_object('from',clock_timestamp()-interval '1 hour','to',clock_timestamp())")
   body=body.replace('p_club',f"'{C}'::uuid").replace('p_user',f"'{base.CARL}'::uuid").replace('p_from',"'"+bounds['from']+"'::timestamptz").replace('p_to',"'"+bounds['to']+"'::timestamptz")
   plan=db.json('EXPLAIN (ANALYZE,FORMAT JSON) '+body)
   check('actual original paid reader uses bounded member and clock index','ca_promo_original_paid_fee_member' in json.dumps(plan),True)
   def index_conditions(node):
    if isinstance(node,dict):return [str(node.get('Index Cond',''))]+[item for value in node.values() for item in index_conditions(value)]
    if isinstance(node,list):return [item for value in node for item in index_conditions(value)]
    return []
   check('paid index restricts actual earned clock as well as member',any('earned_at' in condition and 'player_id' in condition for condition in index_conditions(plan)),True)
   performance=json.loads((args.output/'PERFORMANCE.json').read_text());performance.update({'paid_source_rows':30003,'paid_source_state_calls':1,'paid_source_index':'ca_promo_original_paid_fee_member','paid_reader_execution_ms':plan[0]['Execution Time']});(args.output/'PERFORMANCE.json').write_text(json.dumps(performance,indent=2)+'\n')
   # The original grant schema deliberately permits orphan historical rows.
   # A deleted recipient must not make a future fee or closure fail on the
   # notification foreign key, nor invent a delivery receipt.
   db.run(f"INSERT INTO profiles VALUES('{base.STRANGER}'); INSERT INTO club_members VALUES('{C}','{base.STRANGER}',80,'member')")
   orphan=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{base.STRANGER}',10,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
   db.run(f"DELETE FROM profiles WHERE id='{base.STRANGER}'; WITH clock AS(INSERT INTO ca_promo_cash_hand_clocks VALUES(gen_random_uuid(),'{C}',1,clock_timestamp()) RETURNING hand_id) INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount) SELECT hand_id,'{base.STRANGER}','{C}',40 FROM clock; SELECT fn_ca_promo_play_through_settle('{C}','{base.STRANGER}')")
   check('deleted recipient never blocks original completed closure',db.one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{orphan}'"),'met')
   check('orphan completion retains accounting without claiming push delivery',db.one(f"SELECT notification_id IS NULL AND principal_amount=10 FROM ca_promo_notice_milestones WHERE grant_id='{orphan}' AND milestone='unlocked'"),'t')

   # Install selected actual W gate/custody and original transition owners only
   # after the unchanged principal-meter proof. No new fee allocator adapter.
   profit_source=args.profit_migration.read_text()
   profit_components={}
   for table in ['ca_promo_profit_gates','ca_promo_profit_overrides','ca_promo_profit_fee_phases','ca_promo_profit_custody']:
    ddl=re.search(r'CREATE TABLE public\.'+table+r' \(.*?\n\);',profit_source,re.S).group(0)
    db.run(ddl);profit_components[table]=hashlib.sha256(ddl.encode()).hexdigest()
   for name in ['fn_ca_promo_profit_seed','fn_ca_promo_profit_gate_is_final','fn_ca_promo_profit_earned_notice','fn_ca_promo_profit_override_member','fn_ca_promo_profit_override_notice']:
    ddl=function(profit_source,name);db.run(ddl);profit_components[name]=hashlib.sha256(ddl.encode()).hexdigest()
   for name in ['ca_promo_profit_seed','ca_promo_profit_gate_final','ca_promo_profit_earned_notice','ca_promo_profit_override_notice']:
    ddl=re.search(r'CREATE TRIGGER '+name+r' .*?;',profit_source,re.S).group(0)
    db.run(ddl);profit_components[name]=hashlib.sha256(ddl.encode()).hexdigest()
   inputs=json.loads((args.output/'INPUTS.json').read_text());inputs.update({'profit_migration_sha256':hashlib.sha256(profit_source.encode()).hexdigest(),'profit_notice_components_sha256':profit_components});(args.output/'INPUTS.json').write_text(json.dumps(inputs,indent=2)+'\n')
   check('profit earned callback is private',db.one("SELECT has_function_privilege('authenticated','fn_ca_promo_notice_profit_unlocked(uuid,timestamptz)','EXECUTE')"),'f')
   wg=grant()
   check('unmet profit gate cannot claim earned completion','original_profit_earned_transition_required' in db.run(f"SELECT fn_ca_promo_notice_profit_unlocked('{wg}',clock_timestamp())",check=False).stderr,True)
   foreign='60000000-0000-4000-8000-000000000001'
   db.run(f"INSERT INTO ca_promo_profit_custody VALUES('{wg}','{foreign}','{A}','agent_wallet','{A}',12)")
   stamp=db.one(f"UPDATE ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id='{wg}' RETURNING unlocked_at")
   check('actual original earned transition produces one profit milestone before principal completion',db.one(f"SELECT count(*) FROM ca_promo_notice_milestones n JOIN ca_promo_play_through_grants g ON g.id=n.grant_id WHERE n.grant_id='{wg}' AND n.milestone='profit_unlocked' AND g.closed_at IS NULL AND n.principal_amount=0 AND n.fee_target=100"),'1')
   check('earned profit notice binds actual foreign holder without substituting source club',db.one(f"SELECT user_id='{A}' AND data->>'club_id'='{foreign}' AND data->>'source_club_id'='{C}' AND data->>'profit_amount'='12' AND message LIKE '%Source Review Holds Still Apply%' FROM notifications WHERE data->>'grant_id'='{wg}' AND data->>'milestone'='profit_unlocked'"),'t')
   db.run(f"SELECT fn_ca_promo_notice_profit_unlocked('{wg}','{stamp}'::timestamptz)")
   check('same earned gate replay sends exactly one notification and original push',db.one(f"SELECT (SELECT count(*) FROM notifications WHERE data->>'grant_id'='{wg}' AND data->>'milestone'='profit_unlocked')=1 AND (SELECT count(*) FROM push_outbox WHERE related_entity_id IN(SELECT id FROM notifications WHERE data->>'grant_id'='{wg}' AND data->>'milestone'='profit_unlocked'))=1"),'t')
   manual=grant()
   db.run(f"INSERT INTO ca_promo_profit_custody VALUES('{manual}','{C}','{A}','player_wallet','{A}',5); SELECT set_config('test.uid','{A}',false); SELECT fn_ca_promo_profit_override_member('{C}','{A}','{A}','Private Support Review Detail')")
   check('actual authorized W support decision reaches recipient refresh without leaking its note',db.one(f"SELECT n.user_id='{A}' AND n.data->>'milestone'='support_override' AND n.message NOT LIKE '%Private Support Review Detail%' AND w.unlocked_at IS NULL FROM notifications n JOIN ca_promo_profit_gates w ON w.grant_id='{manual}' WHERE n.data->>'grant_id'='{manual}' AND n.data->>'milestone'='support_override'"),'t')
   db.run(f"SELECT fn_ca_promo_play_through_override('{C}','{A}','Private Principal Review Detail')")
   check('P and W support decisions on one original gift deduplicate their refresh notice and push',db.one(f"SELECT (SELECT count(*) FROM notifications WHERE data->>'grant_id'='{manual}' AND data->>'milestone'='support_override')=1 AND (SELECT count(*) FROM push_outbox o JOIN notifications n ON n.id=o.related_entity_id WHERE n.data->>'grant_id'='{manual}' AND n.data->>'milestone'='support_override')=1"),'t')
   check('support override receipt never forges earned profit completion',db.one(f"SELECT count(*) FROM ca_promo_notice_milestones WHERE grant_id='{manual}' AND milestone='profit_unlocked'"),'0')
   empty=grant()
   db.run(f"UPDATE ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id='{empty}'")
   check('earned empty-position gate still notifies original recipient with zero profit amount',db.one(f"SELECT user_id='{A}' AND data->>'club_id'='{C}' AND data->>'profit_amount'='0' FROM notifications WHERE data->>'grant_id'='{empty}' AND data->>'milestone'='profit_unlocked'"),'t')
   check('profit milestone is excluded from original principal release totals',db.one("SELECT count(*) FROM ca_promo_notice_milestones WHERE milestone='profit_unlocked' AND principal_amount<>0"),'0')
   removed=grant()
   db.run(f"DELETE FROM profiles WHERE id='{A}'; UPDATE ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id='{removed}'")
   check('deleted recipient preserves earned profit milestone without inventing delivery',db.one(f"SELECT notification_id IS NULL AND principal_amount=0 FROM ca_promo_notice_milestones WHERE grant_id='{removed}' AND milestone='profit_unlocked'"),'t')
   verify_cashout_only_notices(db,check,args.output/'INPUTS.json')

  finally:
   (args.output/'RESULTS.json').write_text(json.dumps(results,indent=2)+'\n')
   if started:subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'-m','immediate','-w','stop'],capture_output=True)
if __name__=='__main__':main()
