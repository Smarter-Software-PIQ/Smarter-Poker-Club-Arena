#!/usr/bin/env python3
"""Native integrity custody using actual source owners and isolated opening facts.

Dependency roots may identify unmerged owned candidates during local integration;
CI defaults to the current protected source tree. No production connection.
"""
import argparse,hashlib,importlib.util,json,os,subprocess,tempfile,uuid
from pathlib import Path
from decimal import Decimal,InvalidOperation
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('promo_base',ROOT/'scripts/ci/test-promo-play-through.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
C,A,B=base.CLUB,base.ALICE,base.BOB
T='60000000-0000-0000-0000-000000000001'
H='60000000-0000-0000-0000-000000000002'
MIGRATION=ROOT/'supabase/migrations/20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql'
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
 p.add_argument('--custody-root',type=Path,default=ROOT);p.add_argument('--fee-root',type=Path,default=ROOT)
 p.add_argument('--ticket-root',type=Path,default=ROOT);a=p.parse_args()
 if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
  raise SystemExit('external TMPDIR required')
 a.output.mkdir(parents=True,exist_ok=False);tmp=Path(tempfile.mkdtemp(prefix='ih-'));pg=Path(base.pg_bin());port=54429
 db=base.Db(str(tmp),port,'promo_integrity');started=False;checks=[];inputs=[Path(__file__),MIGRATION];input_hashes={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in inputs}
 def track(f):
  inputs.append(f);digest=hashlib.sha256(f.read_bytes()).hexdigest()
  if str(f) in input_hashes and input_hashes[str(f)]!=digest:raise RuntimeError('prerequisite changed during qualification: '+str(f))
  input_hashes[str(f)]=digest
 def runfile(f):track(f);db.run(f.read_text())
 def section(f,start,end):track(f);s=f.read_text();db.run(s[s.index(start):s.index(end)])
 def check(label,q,expected):
  actual=db.one(q);ok=actual==expected
  if not ok:
   try:ok=Decimal(actual)==Decimal(expected)
   except(InvalidOperation,ValueError,TypeError):pass
  checks.append(dict(check=label,ok=ok,actual=actual,expected=expected))
  print(('PASS ' if ok else 'FAIL ')+label,flush=True)
  if not ok:raise AssertionError(checks[-1])
 try:
  subprocess.run([pg/'initdb','-D',tmp/'data','-U','postgres','-A','trust'],check=True,capture_output=True)
  subprocess.run([pg/'pg_ctl','-D',tmp/'data','-w','-o',f"-p {port} -k {tmp} -c listen_addresses=''",'-l',tmp/'log','start'],check=True,capture_output=True);started=True
  db.run('CREATE DATABASE promo_integrity',db='postgres');db.run(base.STUB)
  db.run(f"""CREATE TABLE agents(club_id uuid,user_id uuid,agent_wallet_balance numeric);
   CREATE TABLE clubs(id uuid PRIMARY KEY,asset text,union_id uuid);INSERT INTO clubs VALUES('{C}','chips',NULL);
   CREATE TABLE tournaments(id uuid PRIMARY KEY,club_id uuid,status text);
   CREATE TABLE tournament_tickets(id uuid PRIMARY KEY,club_id uuid,holder_id uuid);
   ALTER TABLE tournament_players ADD COLUMN club_id uuid, ADD COLUMN chips numeric DEFAULT 0, ADD COLUMN prize numeric DEFAULT 0; CREATE SCHEMA IF NOT EXISTS smarter_private; CREATE TABLE smarter_private.free_buy_ticket_redemptions(registration_id uuid,tournament_id uuid,user_id uuid,returned_at timestamptz);CREATE UNIQUE INDEX ON tournament_players(tournament_id,user_id);
   CREATE TABLE tournament_refund_entitlements(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,refund_wallet_club_id uuid,gross numeric,source_ledger_id uuid,refund_fee numeric DEFAULT 0,registration_id uuid,entitlement_kind text DEFAULT 'wallet_charge');
   CREATE TABLE tournament_refund_tranches(entitlement_id uuid,tournament_id uuid,user_id uuid,source_wallet_club_id uuid,refund_fee numeric);
   CREATE TABLE wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,table_id uuid,type text,category text,amount numeric,balance_after numeric);
   ALTER TABLE table_seats ADD COLUMN occupancy_id uuid DEFAULT gen_random_uuid(),ADD COLUMN joined_at timestamptz DEFAULT clock_timestamp();
   ALTER TABLE rake_records ADD COLUMN hand_id uuid,ADD COLUMN source text;
   ALTER TABLE rake_attributions ADD COLUMN hand_id uuid;
   CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,committed_at timestamptz DEFAULT clock_timestamp());
   ALTER TABLE accounting_tournament_fee_sources ADD COLUMN rake_record_id uuid,ADD COLUMN source_charge_ledger_id uuid,ADD COLUMN source_entitlement_id uuid;
   CREATE TABLE tournament_unregistration_receipts(registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
   CREATE TABLE tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,total_rake_before numeric,total_rake_after numeric,fees_reversed numeric,fee_reversal_ids uuid[]);
   INSERT INTO tables VALUES('{T}',NULL,'{C}');INSERT INTO table_seats(table_id,user_id,stack) VALUES('{T}','{A}',0),('{T}','{B}',0);
  """)
  cash=ROOT/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql'
  section(cash,'CREATE TABLE public.cash_participant_funding_receipts','-- Invoked only by the original private funding cores')
  section(cash,'CREATE FUNCTION public.fn_cash_record_original_funding','-- This is a prospective game/roster snapshot')
  for f in base.MIGRATIONS:runfile(Path(f))
  capture=ROOT/'tests/fixtures/ev-cashout-lifecycle/captured-authorities.json';track(capture)
  original=next(r for r in json.loads(capture.read_text())['functions'] if r['signature'].split('(')[0]=='fn_ca_commit_hand_settlement')
  db.run(original['definition'])
  inventory=a.custody_root/'tests/fixtures/promo-custody-inventory-pin.json';track(inventory)
  inventory_row=json.loads(inventory.read_text())
  for original_owner in inventory_row['funding_owners']:db.run(original_owner['definition']+';')
  db.run('CREATE SCHEMA IF NOT EXISTS smarter_private;'+inventory_row['definition']+';REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;')
  runfile(a.custody_root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql')
  original_fee_reader=db.one("SELECT pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure)")
  fee=a.fee_root/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql';track(fee)
  db.run(fee.read_text().split('DO $owners$')[0]+'COMMIT;')
  ticket=next((a.ticket_root/'supabase/migrations').glob('20261116154719_*.sql'))
  section(ticket,'CREATE TABLE public.ca_promo_event_principal_lots','CREATE FUNCTION public.fn_ca_promo_retire_busted_entry(')
  section(ticket,'CREATE FUNCTION public.fn_ca_promo_finish_event_principal()','-- The ordinary debit already owns')
  section(ticket,'CREATE FUNCTION public.fn_ca_promo_roll_event_principal(','-- One original money owner, explicit source')
  db.run("CREATE FUNCTION fn_ca_promo_ticket_entry_funding(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{\"covered_amount\":0,\"promo_amount\":0}'::jsonb$$;")
  track(MIGRATION)
  wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
  guarded=subprocess.run(['node','--input-type=module','-e',wrapper,MIGRATION.name],input=MIGRATION.read_text(),text=True,capture_output=True,check=True,cwd=ROOT).stdout
  db.run(guarded)
  check('full integrity migration compiles against original custody and fee helpers',"SELECT count(*) FROM pg_proc WHERE proname='fn_ca_promo_integrity_accept_hand'",'1')
  def held(kind='player_wallet',who=A,entity=None):
   return f"public.fn_ca_promo_integrity_locked_at('{C}','{who}','{kind}','{entity or who}')"
  def seed(promo=30,h=20,balance=100,source_kind='club_promo',fund_type='promo_wallet',fund_id=C):
   case=str(uuid.uuid4())
   db.run(f"""UPDATE ca_promo_integrity_custody SET amount=0;
    UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='override' WHERE closed_at IS NULL;
    UPDATE club_members SET chip_balance={balance} WHERE club_id='{C}' AND user_id='{A}';
    UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
    SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',{promo},'{source_kind}','opening:{case}',NULL,'{fund_type}','{fund_id}',NULL) WHERE {promo}>0;
    INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence)
     VALUES('{case}',gen_random_uuid(),'{C}','{B}','{C}','{A}',{h},'{{"fixture":"isolated original opening principal"}}');
    INSERT INTO ca_promo_integrity_custody VALUES('{case}','{C}','{A}','player_wallet','{A}',{h});
   """)
   return case
  def cash_fund(amount,before,who=A,pending=None):
   lid,wid=str(uuid.uuid4()),str(uuid.uuid4());kind='addon' if pending else 'buyin';pnd="NULL" if pending is None else "'"+pending+"'::uuid"
   db.run(f"""BEGIN;
    UPDATE club_members SET chip_balance={before-amount} WHERE club_id='{C}' AND user_id='{who}';
    INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
     VALUES('{lid}','player_wallet','{who}','table_stack','{T}',{amount},'{kind}','{C}');
    INSERT INTO wallet_transactions VALUES('{wid}','{who}','{T}','debit','{kind}',{amount},{before-amount});
    SELECT fn_cash_record_original_funding('{kind}','{lid}','{who}','{T}','{lid}','{wid}','{C}',{amount},{before-amount},{pnd});
    UPDATE table_seats SET stack=CASE WHEN {pnd} IS NULL THEN {amount} ELSE stack END WHERE table_id='{T}' AND user_id='{who}';COMMIT;
   """)
   return lid
  seed();lid=cash_fund(70,100)
  check('original admission spends fifty clean chips before twenty held chips',f"SELECT principal_before||':'||principal_moved FROM ca_promo_integrity_funding WHERE ledger_id='{lid}'",'20:20')
  check('admission preserves all promo in original wallet',f"SELECT fn_ca_promo_locked_at('{C}','{A}','player_wallet','{A}')",'30')
  check('held principal follows the actual original cash funding receipt',f"SELECT {held()}||':'||{held('table_stack',entity=T)}",'0:20')
  check('same-wallet identity leg never moves held principal',f"SELECT fn_ca_promo_integrity_move('{C}','{A}','table_stack','{T}','table_stack','{T}',20)",'0')
  opening_case=seed();cash_fund(100,100)
  def hand(before,after,contribution=60,bank=0,winner_after=100,winner_before=100,provenance=False,insurance=None):
   hand_id=str(uuid.uuid4());stacks=json.dumps([dict(user_id=A,stack_before=before,stack=after),dict(user_id=B,stack_before=winner_before,stack=winner_after)])
   facts=json.dumps(dict(contributions={A:contribution,B:contribution},returned_uncalled={},insurance=insurance or [],private_stats={'ignored':True}))
   if provenance:
    participants=json.dumps([dict(user_id=x,funding_receipts=[dict(funding_club_id=C)]) for x in [A,B]])
    db.run(f"""INSERT INTO cash_hand_provenance_receipts(table_id,hand_number,hand_id,payload_hash,accepted_request,
     atomic_receipt,stack_claim,stack_settlement,status,participants,all_players_included,funding_provenance_complete,issues)
     VALUES('{T}',{uuid.uuid4().int%1000000000},'{hand_id}','isolated-opening','{{}}','{{}}','[]','[]','captured','{participants}',true,true,'[]');""")
   db.run(f"""BEGIN;INSERT INTO hand_atomic_commits VALUES('{hand_id}','{T}',{uuid.uuid4().int%1000000000},clock_timestamp());
    UPDATE table_seats SET stack={after} WHERE table_id='{T}' AND user_id='{A}';
    SELECT fn_ca_promo_accept_cash_hand('{hand_id}','{T}','{stacks}','{facts}');
    SELECT fn_ca_promo_integrity_accept_hand('{hand_id}','{T}','{stacks}','{facts}','{{}}',{bank});COMMIT;""")
   return hand_id,stacks,facts
  hand_id,stacks,facts=hand(100,60)
  check('mixed hand freezes only the actually held contribution',f"SELECT held_contribution||':'||principal_lost FROM ca_promo_integrity_hand_funding WHERE hand_id='{hand_id}'",'10:0')
  record=str(uuid.uuid4());contract=json.dumps(dict(rake_credit=10,club_id=C,player_id=A,tiers=[dict(rate=.5,rake_basis=10,remaining_basis=10,amount=5)],club_residual=5))
  db.run(f"INSERT INTO rake_records(id,hand_id,rake_amount,created_at) VALUES('{record}','{hand_id}',10,clock_timestamp())")
  check('canonical fee helper excludes actual H contribution while preserving gross',f"SELECT c->>'rake_credit'||':'||(c->>'payable_rake_credit')||':'||(c->>'promo_excluded_credit') FROM (SELECT fn_ca_promo_cash_payable_contract('{record}','{C}','{A}','{contract}') c) x",'10:8.33:1.67')
  check('combined funding retains original promo target without minting a hold grant',"SELECT count(*)||':'||sum(fee_target)::integer FROM ca_promo_play_through_grants WHERE closed_at IS NULL",'1:120')
  check('cash-first loss preserves the original combined principal',f"SELECT fn_ca_promo_locked_at('{C}','{A}','table_stack','{T}')||':'||{held('table_stack',entity=T)}",'30:20')
  db.run(f"SELECT fn_ca_promo_integrity_accept_hand('{hand_id}','{T}','{stacks}','{facts}','{{}}',0)")
  check('original hand replay retains one immutable funding snapshot',f"SELECT count(*) FROM ca_promo_integrity_hand_funding WHERE hand_id='{hand_id}'",'1')
  failed=db.run(f"SELECT fn_ca_promo_integrity_accept_hand('{hand_id}','{T}','{stacks}','{facts}','{{}}',1)",check=False)
  check('conflicting original hand replay refuses',"SELECT "+('true' if failed.returncode and 'original_integrity_hand_conflict' in failed.stderr else 'false'),'t')
  hand(60,40,20)
  check('loss consumes held winnings before original promo principal',f"SELECT fn_ca_promo_locked_at('{C}','{A}','table_stack','{T}')||':'||{held('table_stack',entity=T)}",'30:10')
  hand(40,10,30)
  check('combined principal never exceeds the ending stack',f"SELECT fn_ca_promo_locked_at('{C}','{A}','table_stack','{T}')||':'||{held('table_stack',entity=T)}",'10:0')
  db.run(f"UPDATE club_members SET chip_balance=15 WHERE club_id='{C}' AND user_id='{A}'")
  check('later rakeback remains cashable after held chips are lost',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'15')
  denied=db.run(f"SET ROLE authenticated;SELECT fn_ca_promo_integrity_move('{C}','{A}','player_wallet','{A}',NULL,NULL,1)",check=False)
  check('browser cannot manufacture or move held principal',"SELECT "+('true' if denied.returncode and 'permission denied' in denied.stderr else 'false'),'t')
  denied=db.run(f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{opening_case}','Please Release')",check=False)
  check('ordinary member cannot release another member hold',"SELECT "+('true' if not denied.returncode and 'Only The Club Owner' in denied.stdout else 'false'),'t')
  db.run(f"UPDATE club_members SET role='owner' WHERE club_id='{C}' AND user_id='{B}'")
  result=db.run(f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{opening_case}','Original Hand Reviewed')")
  check('review records one authenticated actor and exact reason',f"SELECT reviewed_by||':'||reason FROM ca_promo_integrity_releases WHERE case_id='{opening_case}'",B+':Original Hand Reviewed')
  db.run(f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{opening_case}','Repeated Review')")
  check('review replay never rewrites the original review',f"SELECT count(*)||':'||min(reason) FROM ca_promo_integrity_releases WHERE case_id='{opening_case}'",'1:Original Hand Reviewed')
  check('review never retroactively restores excluded source earnings',f"SELECT c->>'payable_rake_credit' FROM (SELECT fn_ca_promo_cash_payable_contract('{record}','{C}','{A}','{contract}') c) x",'8.33')
  case=seed();fee_hand=str(uuid.uuid4());db.run(f"INSERT INTO hand_atomic_commits VALUES('{fee_hand}','{T}',{uuid.uuid4().int%1000000000},clock_timestamp());SELECT fn_ca_promo_capture_cash_hand_clock('{fee_hand}','{T}');INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES('{fee_hand}','{A}','{C}',120,clock_timestamp());SELECT fn_ca_promo_play_through_settle('{C}','{A}')")
  check('earning the full 4x requirement never releases a review hold',f"SELECT fn_ca_promo_locked_at('{C}','{A}','player_wallet','{A}')||':'||{held()}",'0:20')
  check('review hold reduces cashable amount independently of promo progress',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'80')
  check('own hold read never exposes private accepted-hand facts',f"SET ROLE authenticated;SET test.uid='{A}';SELECT position('accepted_request' in fn_ca_promo_integrity_read('{C}')::text)",'0')
  check('member cannot read another member hold cases',f"SET ROLE authenticated;SET test.uid='{A}';SELECT fn_ca_promo_integrity_read('{C}','{B}')->>'error'",'Not Authorized')
  attempt=db.run(f"BEGIN;UPDATE club_members SET chip_balance=15 WHERE club_id='{C}' AND user_id='{A}';INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('player_wallet','{A}','club_treasury','{C}',85,'cash_out','{C}');SET CONSTRAINTS ALL IMMEDIATE;COMMIT;",check=False)
  check('held-only cashout refuses atomically without an open promo grant',"SELECT "+('true' if attempt.returncode and 'Integrity Review' in attempt.stderr else 'false'),'t')
  check('refused financial exit preserves the original wallet',f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'",'100')
  db.run(f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{case}','Hold Reviewed And Released')")
  check('review releases only the remaining held principal',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'100')
  check('review freezes the exact released amount',f"SELECT released_amount FROM ca_promo_integrity_releases WHERE case_id='{case}'",'20')
  check('review replay returns the original released amount',f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{case}','Repeated Review')->>'released_amount'",'20')
  lid=cash_fund(50,100)
  ordinary,_,_=hand(50,45,5)
  check('unrestricted hand stores no integrity receipt',f"SELECT count(*) FROM ca_promo_integrity_hand_receipts WHERE hand_id='{ordinary}'",'0')
  check('subsequent clean funding acquires no retroactive hold',f"SELECT principal_before||':'||principal_moved FROM ca_promo_integrity_funding WHERE ledger_id='{lid}'",'0:0')
  seed();pending=str(uuid.uuid4());db.run(f"UPDATE table_seats SET stack=0 WHERE table_id='{T}' AND user_id='{A}'")
  cash_fund(70,100,pending=pending)
  check('held addon stays in its original pending position',f"SELECT {held('pending_addon',entity=pending)}",'20')
  db.run(f"UPDATE club_members SET chip_balance=40 WHERE club_id='{C}' AND user_id='{A}';INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('table_stack','{T}','player_wallet','{A}',10,'player_funding','{C}');UPDATE table_seats SET stack=60 WHERE table_id='{T}' AND user_id='{A}'")
  occupancy=db.one(f"SELECT occupancy_id FROM table_seats WHERE table_id='{T}' AND user_id='{A}'")
  db.run(f"SELECT fn_cash_record_funding_application('{pending}',60,10,'{occupancy}')")
  check('partial addon applies only its held share after clean funds',f"SELECT {held('table_stack',entity=T)}",'10')
  check('unused held addon returns to its exact original wallet',f"SELECT {held()}",'10')
  db.run(f"SELECT fn_ca_promo_apply_pending_cash_funding('{pending}')")
  check('pending response-loss replay never duplicates held principal',f"SELECT {held('pending_addon',entity=pending)}=0 AND {held('table_stack',entity=T)}=10 AND {held()}=10",'t')
  donor_case=seed(promo=50,h=0,balance=50);cash_fund(50,50)
  suspect,_,_=hand(50,0,50,5,95,50,True)
  check('provable heads-up gift holds only recipient inflow after all bank fees',f"SELECT amount FROM ca_promo_integrity_cases WHERE hand_id='{suspect}'",'45')
  check('suspect recipient gets a separate hold without a promo grant',f"SELECT {held('table_stack',B,T)}||':'||(SELECT count(*) FROM ca_promo_play_through_grants WHERE user_id='{B}')",'45:0')
  check('busted original promo target stays closed',f"SELECT remaining||':'||close_reason FROM ca_promo_play_through_grants WHERE source_ref='opening:{donor_case}'",'0:spent')
  db.run(f"""BEGIN;UPDATE club_members SET chip_balance=595 WHERE club_id='{C}' AND user_id='{B}';
   UPDATE table_seats SET stack=0 WHERE table_id='{T}' AND user_id='{B}';
   INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
    VALUES('table_stack','{T}','player_wallet','{B}',95,'table_cashout','{C}');COMMIT;""")
  check('table exit always returns held chips to the original player wallet',f"SELECT {held(who=B)}",'45')
  check('recipient own chips and profit outside held inflow stay cashable',f"SELECT fn_ca_promo_play_through_summary('{C}','{B}')->>'cashable'",'550')
  db.run(f"UPDATE club_members SET chip_balance=610 WHERE club_id='{C}' AND user_id='{B}'")
  check('recipient subsequent rakeback stays cashable',f"SELECT fn_ca_promo_play_through_summary('{C}','{B}')->>'cashable'",'565')
  def enter(price,before,event=None):
   event=event or str(uuid.uuid4());lid=str(uuid.uuid4())
   context=json.dumps(dict(user_id=A,club_id=C,category='tournament_buyin',tournament_id=event,amount=price,balance_before=before,operation_key=lid))
   db.run(f"""BEGIN;INSERT INTO tournaments VALUES('{event}','{C}','RUNNING') ON CONFLICT(id) DO NOTHING;
    INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{event}','{A}','{C}') ON CONFLICT(tournament_id,user_id) DO NOTHING;
    UPDATE club_members SET chip_balance={before-price} WHERE club_id='{C}' AND user_id='{A}';
    SELECT set_config('app.ca_promo_wallet_debit','{context}',true);
    INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
     VALUES('{lid}','player_wallet','{A}','prize_liability','{event}',{price},'tournament_buyin','{C}');COMMIT;""")
   return event,lid
  def prize(event,amount,category='tournament_prize',entitlement=None):
   lid=str(uuid.uuid4());context='' if entitlement is None else entitlement
   db.run(f"""BEGIN;SELECT set_config('app.ca_promo_refund_entitlement','{context}',true);
    UPDATE club_members SET chip_balance=chip_balance+{amount} WHERE club_id='{C}' AND user_id='{A}';
    INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
     VALUES('{lid}','prize_liability','{event}','player_wallet','{A}',{amount},'{category}','{C}');COMMIT;""")
   return lid
  seed();event,charge=enter(100,100)
  check('original entry records combined promo and held exclusion without a second target',f"SELECT charge_amount||':'||promo_amount FROM ca_promo_entry_fee_funding WHERE charge_ledger_id='{charge}'",'100:50')
  check('held entry uses exact original charge case slices',f"SELECT original_amount||':'||remaining FROM ca_promo_integrity_event_lots WHERE charge_ledger_id='{charge}'",'20:20')
  check('canonical tournament fee helper keeps gross and excludes combined funding',f"SELECT c->>'rake_credit'||':'||(c->>'payable_rake_credit') FROM(SELECT fn_ca_promo_tournament_payable_contract('{charge}','{contract}') c) x",'10:5.00')
  prize(event,60)
  check('actual event realization preserves promo then held principal',f"SELECT fn_ca_promo_locked_at('{C}','{A}','player_wallet','{A}')||':'||{held()}",'30:20')
  check('profit above combined realized principal remains cashable',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'10')
  seed();event,charge=enter(100,100);prize(event,35)
  check('partial event award realizes only surviving held principal',f"SELECT {held()}||':'||{held('event',entity=event)}",'5:15')
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{event}'")
  check('original terminal owner retires lost event held principal',f"SELECT {held('event',entity=event)}",'0')
  db.run(f"UPDATE club_members SET chip_balance=chip_balance+25 WHERE club_id='{C}' AND user_id='{A}'")
  check('post-event real credit never revives lost held principal',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'25')
  seed();event,charge=enter(100,100)
  db.run(f"UPDATE club_members SET chip_balance=100 WHERE club_id='{C}' AND user_id='{A}'")
  _,second=enter(100,100,event)
  entitlement=str(uuid.uuid4());db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id) VALUES('{entitlement}','{event}','{A}','{C}',100,'{second}')")
  prize(event,100,'refund',entitlement)
  check('refund of a later clean charge cannot realize older held entry',f"SELECT {held()}||':'||{held('event',entity=event)}",'0:20')
  entitlement=str(uuid.uuid4());db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id) VALUES('{entitlement}','{event}','{A}','{C}',100,'{charge}')")
  prize(event,100,'refund',entitlement)
  check('exact original entry refund realizes only its original held slice',f"SELECT {held()}||':'||{held('event',entity=event)}",'20:0')
  seed();event,charge=enter(100,100);next_event=str(uuid.uuid4());roll=str(uuid.uuid4());next_registration=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments VALUES('{next_event}','{C}','RUNNING');INSERT INTO tournament_players(id,tournament_id,user_id,club_id) VALUES('{next_registration}','{next_event}','{A}','{C}');INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('{roll}','prize_liability','{event}','prize_liability','{next_event}',100,'tournament_buyin','{C}','{{\"user_id\":\"{A}\",\"registration_id\":\"{next_registration}\"}}')")
  check('earned direct entry carries original held case into exact next stage',f"SELECT {held('event',entity=event)}||':'||{held('event',entity=next_event)}",'0:20')
  check('earned direct entry captures actual combined original fee ratio',f"SELECT promo_amount FROM ca_promo_entry_fee_funding WHERE charge_ledger_id='{roll}'",'50')
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{event}'")
  check('earlier terminal event cannot retire rolled surviving principal',f"SELECT remaining||':'||(closed_at IS NULL)::text FROM ca_promo_play_through_grants WHERE closed_at IS NULL",'30:true')
  ticket_id=str(uuid.uuid4());award=str(uuid.uuid4())
  db.run(f"INSERT INTO tournament_tickets VALUES('{ticket_id}','{C}','{A}');INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('{award}','prize_liability','{next_event}','escrow','{ticket_id}',100,'ticket_issue','{C}','{{\"user_id\":\"{A}\"}}')")
  check('earned ticket capability retains held case without buying a promo ticket',f"SELECT {held('event',entity=next_event)}||':'||{held('ticket',entity=ticket_id)}",'0:20')
  third_event,redeem,third_registration=str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments VALUES('{third_event}','{C}','RUNNING');INSERT INTO tournament_players(id,tournament_id,user_id,club_id) VALUES('{third_registration}','{third_event}','{A}','{C}');INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('{redeem}','escrow','{ticket_id}','prize_liability','{third_event}',100,'ticket_redeem','{C}','{{\"user_id\":\"{A}\",\"registration_id\":\"{third_registration}\"}}')")
  check('earned capability redemption carries original case into entry',f"SELECT {held('ticket',entity=ticket_id)}||':'||{held('event',entity=third_event)}",'0:20')
  check('earned capability redemption preserves original fee exclusion and target',f"SELECT f.promo_amount||':'||(SELECT sum(fee_target)::integer FROM ca_promo_play_through_grants WHERE closed_at IS NULL) FROM ca_promo_entry_fee_funding f WHERE f.charge_ledger_id='{redeem}'",'50:120')
  seed(promo=20,h=0,balance=50,source_kind='agent_promo',fund_id=B)
  db.run(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',30,'club_promo','second-fund:{uuid.uuid4()}',NULL,'promo_wallet','{C}',NULL)")
  cash_fund(50,50);source_hand,_,_=hand(50,0,50,5,95,50,True)
  check('flag attribution freezes each actual original funding owner loss',f"SELECT count(*)||':'||sum(amount)::integer FROM ca_promo_integrity_source_grants WHERE hand_id='{source_hand}'",'2:50')
  check('agent flag attribution uses original grant funding rather than current hierarchy',f"SELECT amount::integer FROM ca_promo_integrity_source_grants WHERE hand_id='{source_hand}' AND source_kind='agent_promo' AND funded_from_id='{B}'",'20')
  check('integrity receipts retain monetary facts without private stats',f"SELECT bool_and(NOT(request->'facts' ? 'private_stats') AND (request->'facts' ? 'contributions')) FROM ca_promo_integrity_hand_receipts",'t')
  seed(promo=50,h=0,balance=50);cash_fund(50,50)
  ambiguous,_,_=hand(50,0,50,5,95,50,True,insurance=[{'buyer':A,'amount':1}])
  check('insurance ambiguity records evidence without speculative principal hold',f"SELECT amount FROM ca_promo_integrity_cases WHERE hand_id='{ambiguous}'",'0')
  ambiguous_case=db.one(f"SELECT id FROM ca_promo_integrity_cases WHERE hand_id='{ambiguous}'")
  check('authorized review includes evidence-only zero-principal cases',f"SET ROLE authenticated;SET test.uid='{B}';SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(fn_ca_promo_integrity_read('{C}','{B}')->'cases') k WHERE k->>'case_id'='{ambiguous_case}' AND (k->>'held')::numeric=0 AND (k->>'can_release')::boolean)",'t')
  def fee_entitlement(event,charge,gross,fee):
   entitlement=str(uuid.uuid4())
   db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{event}','{A}','{C}',{gross},'{charge}',{fee})")
   return entitlement
  def capture_fee(event,charge,entitlement,fee):
   source=str(uuid.uuid4());db.run(f"INSERT INTO accounting_tournament_fee_sources(id,tournament_id,player_id,club_id,rake_credit,source_charge_ledger_id,source_entitlement_id) VALUES('{source}','{event}','{A}','{C}',{fee},'{charge}','{entitlement}')");return source
  seed();event,charge=enter(100,100)
  # An original H custody opening whose per-charge lot has not yet arrived.
  # The two real rendezvous callbacks must converge in either event order.
  db.run(f"DELETE FROM ca_promo_integrity_event_lots WHERE charge_ledger_id='{charge}'")
  entitlement=fee_entitlement(event,charge,100,10)
  check('entitlement first waits for original held event lot',f"SELECT count(*) FROM ca_promo_integrity_fee_spends WHERE charge_ledger_id='{charge}'",'0')
  db.run(f"SELECT fn_ca_promo_integrity_record_event('{charge}')")
  check('late original held event lot consumes the same exact fee share',f"SELECT held_fee FROM ca_promo_integrity_fee_spends WHERE charge_ledger_id='{charge}'",'2')
  prize(event,100)
  capture_fee(event,charge,entitlement,10)
  check('late canonical source after prize cannot spend held fees again',f"SELECT {held()}",'18')
  fee_case=seed();event,charge=enter(100,100);entitlement=fee_entitlement(event,charge,100,10)
  check('before regression original source-only meter hides paid mixed-entry fee',"BEGIN;"+original_fee_reader+f";SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress';ROLLBACK;",'0')
  check('original paid gross fee progresses before earning agreement capture',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress'",'10')
  check('actual entitlement retires held fee before earning source exists',f"SELECT held_fee FROM ca_promo_integrity_fee_spends WHERE charge_ledger_id='{charge}'",'2.00')
  check('spent entry fee cannot remain in original event custody',f"SELECT {held('event',entity=event)}",'18.00')
  fee_source=capture_fee(event,charge,entitlement,10)
  check('eventual earning source cannot double the gross mixed-entry progress',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress'",'10')
  db.run(f"SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}');SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')")
  check('exact original fee refund restores one unreleased slice',f"SELECT count(*)||':'||sum(restored)::integer FROM ca_promo_integrity_fee_refunds WHERE entitlement_id='{entitlement}'",'1:2')
  prize(event,100,'refund',entitlement)
  check('refunded held fee follows the actual original wallet realization',f"SELECT {held()}=20 AND {held('event',entity=event)}=0",'t')
  released=seed();event,charge=enter(100,100);entitlement=fee_entitlement(event,charge,100,10)
  db.run(f"SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{released}','Original Case Reviewed');SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')")
  check('released source case fee refund creates no new hold',f"SELECT restored FROM ca_promo_integrity_fee_refunds WHERE entitlement_id='{entitlement}'",'0')
  prize(event,100,'refund',entitlement)
  capture_fee(event,charge,entitlement,10)
  check('late earning source after reviewed refund never reconsumes principal',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'integrity_held'",'0')
  seed(promo=20,h=20,balance=40);event,charge=enter(40,40);entitlement=fee_entitlement(event,charge,40,40)
  check('fully spent held entry leaves no restriction debt',f"SELECT {held('event',entity=event)}",'0')
  db.run(f"SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')");prize(event,40,'refund',entitlement)
  capture_fee(event,charge,entitlement,40)
  check('late fee source reuses spend after an exact spent-fee refund',f"SELECT {held()}",'20.00')
  seed(promo=.01,h=.01,balance=.02);event,charge=enter(.02,.02);entitlement=fee_entitlement(event,charge,.02,.01)
  check('combined cent rounding cannot spend the same fee cent twice',f"SELECT held_fee=0 AND (SELECT remaining FROM ca_promo_integrity_event_lots WHERE charge_ledger_id='{charge}')=.01 FROM ca_promo_integrity_fee_spends WHERE charge_ledger_id='{charge}'",'t')
  def witnessed_bust(event,charge):
   candidate=str(uuid.uuid4());registration=db.one(f"SELECT id FROM tournament_players WHERE tournament_id='{event}' AND user_id='{A}'")
   db.run(f"INSERT INTO ca_promo_event_entry_loss_receipts(candidate_id,registration_id,tournament_id,club_id,user_id,table_id,hand_id,hand_number,operation_ref,principal,charge_ledger_ids) VALUES('{candidate}','{registration}','{event}','{C}','{A}','{T}',gen_random_uuid(),1,'isolated validated original bust opening',0,ARRAY['{charge}'::uuid])")
   return candidate
  lost_case=seed(promo=0,h=20,balance=100);event,charge=enter(100,100);entitlement=fee_entitlement(event,charge,100,10)
  candidate=witnessed_bust(event,charge)
  check('original busted-entry receipt retires only its old held charge',f"SELECT {held('event',entity=event)}",'0')
  check('bust retains immutable exact source loss slices',f"SELECT amount FROM ca_promo_integrity_event_loss_slices WHERE charge_ledger_id='{charge}' AND source_id='{candidate}'",'18')
  db.run(f"UPDATE club_members SET chip_balance=150 WHERE club_id='{C}' AND user_id='{A}'")
  enter(100,150,event);prize(event,100)
  check('later real reentry prize inherits no old held principal',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'150')
  db.run(f"SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')");prize(event,100,'refund',entitlement)
  check('exact old refund restores unreviewed fee and busted principal only',f"SELECT {held()}",'20')
  db.run(f"SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')")
  check('exact busted-source refund replay never restores twice',f"SELECT restored FROM ca_promo_integrity_fee_refunds WHERE entitlement_id='{entitlement}'",'20')
  released_case=seed(promo=0,h=20,balance=100);event,charge=enter(100,100);entitlement=fee_entitlement(event,charge,100,10)
  witnessed_bust(event,charge);db.run(f"SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{released_case}','Reviewed Exhausted Original Source');SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')")
  prize(event,100,'refund',entitlement)
  check('reviewed busted-source refund remains fully cashable',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'100')
  # Stock PostgreSQL scheduling proves the case lock serializes review and
  # source movement. The release never duplicates or revives financial value.
  native_spec=importlib.util.spec_from_file_location('integrity_native',ROOT/'scripts/ci/test-mtt-unlimited.py')
  native=importlib.util.module_from_spec(native_spec);native_spec.loader.exec_module(native)
  binary=native.stock_isolationtester(pg)
  for review_first in [True,False]:
   case=seed(promo=0,h=20,balance=100)
   steps=['review_begin','move_begin']+(['review','move','review_commit','move_commit'] if review_first else ['move','review','move_commit','review_commit'])
   schedule=f"""session "review"
step "review_begin" {{ BEGIN; SET test.uid='{B}'; }}
step "review" {{ SELECT fn_ca_promo_integrity_release('{case}','Concurrent Original Review')->>'success'; }}
step "review_commit" {{ COMMIT; }}
session "move"
step "move_begin" {{ BEGIN; }}
step "move" {{ SELECT fn_ca_promo_integrity_move('{C}','{A}','player_wallet','{A}','table_stack','{T}',20); }}
step "move_commit" {{ COMMIT; }}
permutation {" ".join('"'+x+'"' for x in steps)}
"""
   result=subprocess.run([binary,f'host={tmp} port={port} dbname=promo_integrity user=postgres'],input=schedule,text=True,capture_output=True,timeout=30)
   a.output.joinpath('review-race-'+str(review_first)+'.log').write_text(result.stdout+result.stderr)
   if result.returncode or result.stderr.strip() or 'ERROR:' in result.stdout:raise RuntimeError(result.stdout+result.stderr)
   check('review and movement serialize with conserved principal '+str(review_first),f"SELECT (SELECT released_amount FROM ca_promo_integrity_releases WHERE case_id='{case}')=20 AND (SELECT sum(amount) FROM ca_promo_integrity_custody WHERE case_id='{case}')=20 AND {held()}=0 AND {held('table_stack',entity=T)}=0",'t')
  for review_first in [True,False]:
   case=seed();event,charge=enter(100,100);fee_source=str(uuid.uuid4());entitlement=str(uuid.uuid4())
   steps=['review_begin','fee_begin']+(['review','fee','review_commit','fee_commit'] if review_first else ['fee','review','fee_commit','review_commit'])
   schedule=f"""session "review"
step "review_begin" {{ BEGIN; SET test.uid='{B}'; }}
step "review" {{ SELECT fn_ca_promo_integrity_release('{case}','Concurrent Original Fee Review')->>'success'; }}
step "review_commit" {{ COMMIT; }}
session "fee"
step "fee_begin" {{ BEGIN; }}
step "fee" {{ INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{event}','{A}','{C}',100,'{charge}',10); }}
step "fee_commit" {{ COMMIT; }}
permutation {" ".join('"'+x+'"' for x in steps)}
"""
   result=subprocess.run([binary,f'host={tmp} port={port} dbname=promo_integrity user=postgres'],input=schedule,text=True,capture_output=True,timeout=30)
   a.output.joinpath('review-fee-race-'+str(review_first)+'.log').write_text(result.stdout+result.stderr)
   if result.returncode or result.stderr.strip() or 'ERROR:' in result.stdout:raise RuntimeError(result.stdout+result.stderr)
   check('fee and review conserve exactly the original held amount '+str(review_first),f"SELECT (SELECT released_amount FROM ca_promo_integrity_releases WHERE case_id='{case}')+(SELECT held_fee FROM ca_promo_integrity_fee_spends WHERE charge_ledger_id='{charge}')=20 AND {held('event',entity=event)}=0",'t')
  foreign=str(uuid.uuid4());case=str(uuid.uuid4())
  db.run(f"INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES('{case}',gen_random_uuid(),'{foreign}','{A}','{foreign}','{A}',10,'{{}}');INSERT INTO ca_promo_integrity_custody VALUES('{case}','{C}','{A}','player_wallet','{A}',10)")
  check('target-club admin cannot release a foreign original case',f"SET ROLE authenticated;SET test.uid='{B}';SELECT (k->>'can_release')::boolean FROM jsonb_array_elements(fn_ca_promo_integrity_read('{C}','{A}')->'cases') k WHERE k->>'case_id'='{case}'",'f')
  a.output.joinpath('QUALIFICATION-LIMITS.txt').write_text('Actual custody, original cash funding owner, eligible-fee helpers and original event principal source execute. Typed minimal balances/receipts isolate this proof. Full accepted-hand/commission/payable integration is a separate required proof.\n')
  if any(hashlib.sha256(Path(f).read_bytes()).hexdigest()!=digest for f,digest in input_hashes.items()):raise RuntimeError('prerequisite changed during qualification')
  status='passed'
 finally:
  if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','-w','stop'],capture_output=True)
  a.output.joinpath('RESULTS.json').write_text(json.dumps(dict(status=locals().get('status','failed'),production_mutations=False,checks=checks,
   source_sha256=input_hashes),indent=2)+'\n')
if __name__=='__main__':main()
