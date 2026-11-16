#!/usr/bin/env python3
"""Native original FIFO meter + actual notification bridge, isolated PostgreSQL only."""
import argparse, importlib.util, json, os, re, subprocess, tempfile, time, hashlib
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
ALTER TABLE accounting_tournament_fee_sources ADD COLUMN rake_record_id uuid;
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
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--custody-migration',type=Path,default=ROOT/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql');p.add_argument('--integrity-migration',type=Path,default=ROOT/'supabase/migrations/20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql');args=p.parse_args()
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
   for f in base.MIGRATIONS:db.run(Path(f).read_text())
   integrity=args.integrity_migration.read_text()
   for table in ['ca_promo_integrity_cases','ca_promo_integrity_releases','ca_promo_integrity_custody']:
    ddl=re.search(r'CREATE TABLE public\.'+table+r' \(.*?\n\);',integrity,re.S).group(0)
    db.run(ddl)
   db.run(EXTRA.replace('{A}',A).replace('{B}',base.BOB).replace('{CARL}',base.CARL))
   for name in ['fn_ca_promo_integrity_move','fn_ca_promo_integrity_release']:
    db.run(function(integrity,name))
   custody=args.custody_migration.read_text()
   (args.output/'INPUTS.json').write_text(json.dumps({'custody_migration_sha256':hashlib.sha256(custody.encode()).hexdigest(),'custody_components_sha256':{name:hashlib.sha256(function(custody,name).encode()).hexdigest() for name in ['fn_ca_promo_cash_fee_clock_missing','fn_ca_promo_fee_events','fn_ca_promo_play_through_state']},'integrity_migration_sha256':hashlib.sha256(integrity.encode()).hexdigest(),'integrity_components_sha256':{name:hashlib.sha256(function(integrity,name).encode()).hexdigest() for name in ['fn_ca_promo_integrity_move','fn_ca_promo_integrity_release']},'notices_migration_sha256':hashlib.sha256(MIG.read_bytes()).hexdigest(),'owners_sha256':hashlib.sha256((ROOT/'tests/fixtures/promo-notices/owners.sql').read_bytes()).hexdigest()},indent=2)+'\n')
   for name in ['fn_ca_promo_cash_fee_clock_missing','fn_ca_promo_fee_events','fn_ca_promo_play_through_state']:db.run(function(custody,name))
   db.run((ROOT/'tests/fixtures/promo-notices/owners.sql').read_text())
   db.run((ROOT/'tests/fixtures/promo-notices/incident.sql').read_text())
   db.run('CREATE TRIGGER actual_incident_bridge AFTER INSERT ON ledger_reconcile_log FOR EACH ROW EXECUTE FUNCTION fn_ca_reconcile_log_to_incident()')
   db.run("CREATE TRIGGER actual_push_bridge AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fn_mirror_notification_to_push_outbox()")
   db.run(MIG.read_text())
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
   check('observer reports custody and remaining independently',db.one(f"SELECT remaining||':'||custody FROM fn_ca_promo_custody_reconcile_rows() WHERE grant_id='{g2}'"),'50:12')
   check('observer leaves grant unchanged',db.one(f"SELECT remaining FROM ca_promo_play_through_grants WHERE id='{g2}'"),'50')
   check('actual nightly owner contains observer wiring',db.one("SELECT position('fn_ca_promo_custody_reconcile_rows' in prosrc)>0 FROM pg_proc WHERE oid='reconcile_ledger_nightly()'::regprocedure"),'t')
   observer=db.one("SELECT prosrc FROM pg_proc WHERE oid='reconcile_ledger_nightly()'::regprocedure")
   statement=re.search(r"  INSERT INTO public\.ledger_reconcile_log\(entity_type,entity_id,ledger_balance,stored_balance,severity,metadata\).*?FROM public\.fn_ca_promo_custody_reconcile_rows\(\) p;",observer,re.S).group(0)
   db.run(statement)
   check('actual nightly observer statement reaches original incident bridge',db.one(f"SELECT classification||':'||expected||':'||actual FROM test_promo_incidents WHERE entity_id='{g2}'"),'ledger_imbalance:50:12')
   check('existing observer type constraint stays validated',db.one("SELECT convalidated FROM pg_constraint WHERE conrelid='ledger_reconcile_log'::regclass AND conname='ledger_reconcile_log_entity_type_check'"),'t')
   check('actual daily digest contains observer wiring',db.one("SELECT position('fn_ca_promo_daily_digest' in prosrc)>0 FROM pg_proc WHERE oid='fn_sp_daily_digest(date,boolean)'::regprocedure"),'t')
   # Exact original funder partition survives later grants or hierarchy changes.
   db.run(f"UPDATE ca_promo_play_through_grants SET cycle_started_at=(current_date-1)::timestamptz,granted_at=(current_date-1)::timestamptz+interval '12 hours' WHERE id='{g2}'; INSERT INTO ca_promo_principal_return_receipts VALUES('{g2}','expired',7,(current_date-1)::timestamptz+interval '13 hours')")
   db.run(f"INSERT INTO ca_promo_integrity_cases(hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence,created_at) VALUES('{base.TOUR_A}','{C}','{A}','{C}','{base.BOB}',0,'{{}}',(current_date-1)::timestamptz+interval '14 hours'); INSERT INTO ca_promo_integrity_source_grants VALUES('{base.TOUR_A}','{g2}','{C}','{A}','promo_wallet','{base.BOB}',10)")
   report=db.json('SELECT fn_ca_promo_daily_digest(current_date-1)')
   check('digest original grant funding identity',next(x for x in report['funding_owners'] if x['expired']==7)['funded_from_id'],base.BOB)
   check('digest actual expired return amount',sum(x['expired'] for x in report['funding_owners']),7)
   check('digest flags only exact original source funder',next(x for x in report['funding_owners'] if x['funded_from_id']==base.BOB)['flagged'],1)
   check('unrelated current grants do not inherit donor flags',next(x for x in report['funding_owners'] if x['funded_from_id']==A)['flagged'],0)
   check('daily club totals retain exact given principal',report['clubs'][0]['given'],50)
   check('daily club total counts distinct cases once',report['clubs'][0]['flagged'],1)
   # The original grant schema deliberately permits orphan historical rows.
   # A deleted recipient must not make a future fee or closure fail on the
   # notification foreign key, nor invent a delivery receipt.
   db.run(f"INSERT INTO profiles VALUES('{base.STRANGER}'); INSERT INTO club_members VALUES('{C}','{base.STRANGER}',80,'member')")
   orphan=db.one(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{base.STRANGER}',10,'club_promo',gen_random_uuid()::text,NULL,'promo_wallet','{A}',NULL)")
   db.run(f"DELETE FROM profiles WHERE id='{base.STRANGER}'; WITH clock AS(INSERT INTO ca_promo_cash_hand_clocks VALUES(gen_random_uuid(),'{C}',1,clock_timestamp()) RETURNING hand_id) INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount) SELECT hand_id,'{base.STRANGER}','{C}',40 FROM clock; SELECT fn_ca_promo_play_through_settle('{C}','{base.STRANGER}')")
   check('deleted recipient never blocks original completed closure',db.one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{orphan}'"),'met')
   check('orphan completion retains accounting without claiming push delivery',db.one(f"SELECT notification_id IS NULL AND principal_amount=10 FROM ca_promo_notice_milestones WHERE grant_id='{orphan}' AND milestone='unlocked'"),'t')

  finally:
   (args.output/'RESULTS.json').write_text(json.dumps(results,indent=2)+'\n')
   if started:subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'-m','immediate','-w','stop'],capture_output=True)
if __name__=='__main__':main()
