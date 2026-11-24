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
 p.add_argument('--ticket-root',type=Path,default=ROOT);p.add_argument('--return-root',type=Path,default=ROOT);a=p.parse_args()
 if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
  raise SystemExit('external TMPDIR required')
 a.output.mkdir(parents=True,exist_ok=False);tmp=Path(tempfile.mkdtemp(prefix='ih-'));pg=Path(base.pg_bin());port=54432
 db=base.Db(str(tmp),port,'promo_profit');started=False;checks=[];inputs=[Path(__file__),MIGRATION];input_hashes={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in inputs}
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
  db.run('CREATE DATABASE promo_profit',db='postgres');db.run(base.STUB);db.run('CREATE TABLE IF NOT EXISTS ca_money_rpc_registry(proname text PRIMARY KEY,status text,notes text);CREATE TABLE IF NOT EXISTS tournament_obligations(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,amount_owed numeric,amount_paid numeric,terminal_closed_at timestamptz);')
  db.run(f"""CREATE TABLE agents(club_id uuid,user_id uuid,agent_wallet_balance numeric);
   CREATE TABLE clubs(id uuid PRIMARY KEY,asset text,union_id uuid);INSERT INTO clubs VALUES('{C}','chips',NULL);
   CREATE TABLE tournaments(id uuid PRIMARY KEY,club_id uuid,status text);
   CREATE TABLE tournament_tickets(id uuid PRIMARY KEY,club_id uuid,holder_id uuid,value numeric,status text DEFAULT 'issued');
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
  # The financial/custody fixture has no notification service. The actual
  # callback is qualified in the maintained notice closure; this sink records
  # only the real earned transition invocation, never delivery success.
  db.run("CREATE SCHEMA fixture_only;CREATE TABLE fixture_only.profit_notice_calls(grant_id uuid PRIMARY KEY,unlocked_at timestamptz);CREATE FUNCTION public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz) RETURNS void LANGUAGE sql AS $$INSERT INTO fixture_only.profit_notice_calls VALUES($1,$2) ON CONFLICT(grant_id) DO NOTHING$$;REVOKE ALL ON FUNCTION public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;")
  db.run("CREATE TABLE fixture_only.support_notice_calls(grant_id uuid PRIMARY KEY);CREATE FUNCTION public.fn_ca_promo_notice_support_override(uuid) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_only.support_notice_calls VALUES($1) ON CONFLICT(grant_id) DO NOTHING;RETURN true;END$$;REVOKE ALL ON FUNCTION public.fn_ca_promo_notice_support_override(uuid) FROM PUBLIC,anon,authenticated,service_role;")
  # Actual BBJ recipient definition is installed for full migration/preimage
  # qualification; its money execution has a separate maintained proof.
  bbj=ROOT/'tests/fixtures/promo-profit-bbj/recipient-owner.json';track(bbj)
  db.run('CREATE TABLE bbj_payouts(id uuid PRIMARY KEY,pool_id uuid,table_id uuid,hand_id uuid,hand_number bigint,kind text,created_at timestamptz DEFAULT now(),metadata jsonb);')
  db.run(json.loads(bbj.read_text())['definition']+';')
  ticket_capture=a.ticket_root/'tests/fixtures/promo-ticket-play-through/additional-owners.json';track(ticket_capture)
  for source in json.loads(ticket_capture.read_text()):
   if source['signature'].startswith('fn_issue_tournament_ticket_phase2_core_20260831('):db.run(source['definition']+';')
  section(ticket,'DO $cash_ticket_owner$','CREATE OR REPLACE FUNCTION public.fn_issue_tournament_ticket_phase2_core_20260831(')
  # Exact original refund owners, not financial substitutes. Their execution
  # is qualified separately under the maintained real journal foundation.
  returns=next((a.return_root/'supabase/migrations').glob('20261116154841_*.sql'));track(returns)
  return_sql=returns.read_text()
  db.run(return_sql[return_sql.index('CREATE TABLE public.ca_promo_principal_return_receipts'):return_sql.index('-- Original refund/redemption owners')])
  import re
  for name in ('fn_ca_promo_return_principal','fn_ca_promo_return_spent_event_fee'):
   start=return_sql.index('CREATE FUNCTION public.'+name+'(')
   end=return_sql.index('REVOKE ALL ON FUNCTION public.'+name+'(',start)
   end=return_sql.index(';',end)+1
   db.run(return_sql[start:end])
  w=next((ROOT/'supabase/migrations').glob('20261116190221_*.sql'));track(w)
  guarded_w=subprocess.run(['node','--input-type=module','-e',wrapper,w.name],input=w.read_text(),text=True,capture_output=True,check=True,cwd=ROOT).stdout
  db.run(guarded_w)
  # The engine's contribution is already net of an uncalled return (contract:
  # scripts/ci/fixtures/promo-hand-commit-payload/contract.json). Every later
  # check here runs on the readers that no longer subtract it a second time.
  runfile(ROOT/'supabase/migrations/20261124180000_promo_fee_exposure_counts_the_engines_net_contribution.sql')
  readers="pronamespace='public'::regnamespace AND proname IN('fn_ca_promo_accept_cash_hand','fn_ca_promo_profit_capture_cash','fn_ca_promo_integrity_accept_hand')"
  check('all three cash promo readers of the accepted facts are installed',f"SELECT count(*) FROM pg_proc WHERE {readers}",'3')
  check('no cash promo reader subtracts the uncalled return from the net contribution',f"SELECT count(*) FROM pg_proc WHERE {readers} AND position($a$-COALESCE((p_facts->'returned_uncalled'->>$a$ IN pg_get_functiondef(oid))>0",'0')
  fee_clocks=ROOT/'tests/fixtures/promo-profit-fee-clocks/native.sql'
  track(fee_clocks)
  original_cases=f"\\set club '{C}'\n\\set member '{A}'\n\\set table '{T}'\n"+fee_clocks.read_text()
  for historical_rows in (0,300):
   db.run(f"\\set historical_rows {historical_rows}\n"+original_cases)
  runfile(ROOT/'supabase/migrations/20261118002028_promo_cash_fees_seek_their_original_earned_clocks.sql')
  for historical_rows in (0,300):
   db.run(f"\\set historical_rows {historical_rows}\n"+original_cases)
  check('original fee clock reader remains owner-only and matches the reviewed body',"""
    SELECT md5(pg_get_functiondef(oid))='ce0857b0f9b897417f1970d99244bf59' AND prosecdef
      AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}'
    FROM pg_proc WHERE oid='public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure
  """,'t')
  runfile(ROOT/'supabase/migrations/20261118024233_compare_member_and_clock_windows_before_reading_original_cas.sql')
  for member_rows,window_rows in ((0,0),(300,0),(1308,2000),(16385,0)):
   db.run(f"\\set historical_rows {member_rows}\n\\set window_rows {window_rows}\n"+original_cases)
  check('member and clock routing preserves the private original reader',"""
    SELECT md5(pg_get_functiondef(oid))='cadf29b87340d1d1d6884ac91f0a6b48' AND prosecdef
      AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}'
    FROM pg_proc WHERE oid='public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure
  """,'t')
  runfile(ROOT/'supabase/migrations/20261122203048_a_heavy_member_s_promo_fee_reader_measures_both_routes.sql')
  for member_rows,window_rows in ((0,0),(300,0),(1308,2000),(16385,0)):
   db.run(f"\\set historical_rows {member_rows}\n\\set window_rows {window_rows}\n"+original_cases)
  # Incident 9408cfd4: 16,385 recent postings inside a 20,000-hand window. The
  # fixture refuses one posting probe per window hand (the unmeasured route).
  db.run("\\set historical_rows 0\n\\set recent_rows 16385\n\\set window_rows 20000\n"+original_cases)
  check('a heavy member is measured against the clock window and the reader stays owner-only',"""
    SELECT md5(pg_get_functiondef(oid))='9fbd419ad5ae2b8311d4167547415715' AND prosecdef
      AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}'
    FROM pg_proc WHERE oid='public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure
  """,'t')
  check('both actual cash refund owners consume exact bust and terminal loss basis',"SELECT count(*) FROM pg_proc WHERE proname IN('fn_ca_promo_return_principal','fn_ca_promo_return_spent_event_fee') AND prosrc LIKE '%JOIN public.ca_promo_original_entry_loss_basis fs%'",'2')
  check('terminal loss basis preserves exact lot identity without duplicate rows',"SELECT pg_get_viewdef('public.ca_promo_original_entry_loss_basis'::regclass) LIKE '%UNION%' AND NOT pg_get_viewdef('public.ca_promo_original_entry_loss_basis'::regclass) LIKE '%UNION ALL%'",'t')

  exit_case=ROOT/'tests/fixtures/promo-profit-requested-cashout/native.sql'
  track(exit_case)
  def check_wallet_exit(fixed):
   for wallet_club,after_balance in ((C,70),(base.OTHER_CLUB,20)):
    params=dict(source_club=C,wallet_club=wallet_club,member=A,table=T,after_balance=after_balance,fixed=str(fixed).lower())
    setup=''.join(f"\\set {key} '{value}'\n" for key,value in params.items())
    db.run(setup+exit_case.read_text())
  acl_query="SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='public.fn_ca_promo_play_through_on_exit()'::regprocedure"
  original_exit_acl=db.one(acl_query)
  check_wallet_exit(False)
  runfile(ROOT/'supabase/migrations/20261118005327_promo_external_wallet_exit_settles_earned_source_before_cash.sql')
  check_wallet_exit(True)
  check('wallet exit retains its original visibility and reviewed source', """
   SELECT md5(pg_get_functiondef(oid))='8a850f705e213a7bb89bbf9ce64357c0' AND prosecdef AND
     proowner='postgres'::regrole AND NOT has_function_privilege('anon',oid,'execute')
     AND NOT has_function_privilege('authenticated',oid,'execute')
   FROM pg_proc WHERE oid='public.fn_ca_promo_play_through_on_exit()'::regprocedure
  """,'t')

  check('wallet exit preserves the original role grants',acl_query,original_exit_acl)

  def gift(amount):
   key=str(uuid.uuid4())
   db.run(f"UPDATE club_members SET chip_balance=10000 WHERE club_id='{C}' AND user_id='{A}';UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',{amount},'club_promo','{key}',NULL,'promo_wallet','{C}',NULL)")
   return db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'")
  def fee(amount):
   hand=str(uuid.uuid4())
   db.run(f"INSERT INTO ca_promo_cash_hand_clocks VALUES('{hand}','{T}',1,clock_timestamp());INSERT INTO rake_attributions(club_id,player_id,rake_amount,hand_id) VALUES('{C}','{A}',{amount},'{hand}')")
  old=gift(50)
  # Count actual history evaluations inside this connection's transaction. Each
  # scenario rolls back so subsequent fee and custody checks use the same gift.
  def settlement_reads(setup='', user=A):
   return f"""BEGIN;
    {setup}
    SET LOCAL track_functions = 'all';
    SELECT fn_ca_promo_profit_settle('{C}','{user}');
    SELECT coalesce(pg_stat_get_xact_function_calls(
      'public.fn_ca_promo_shared_fee_state(uuid,uuid)'::regprocedure),0);
    ROLLBACK;"""

  released = f"UPDATE ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id='{old}';"
  overridden = f"""INSERT INTO ca_promo_profit_overrides(grant_id,reviewed_by,reason)
                   VALUES('{old}','{B}','Native fee boundary regression');"""
  check('original settler rereads history after final release',settlement_reads(released),'1')
  runfile(ROOT/'supabase/migrations/20261117234700_skip_promo_profit_fee_replay_for_final_gates.sql')
  check('installed settler keeps its definition and private execute grant',"""
    SELECT md5(pg_get_functiondef(p.oid)) = 'c07f4e3eebcb0de8f34079c07dd2aac8'
       AND p.prosecdef AND p.proowner = 'postgres'::regrole
       AND NOT has_function_privilege('service_role', p.oid, 'execute')
       AND NOT has_function_privilege('authenticated', p.oid, 'execute')
       AND NOT has_function_privilege('anon', p.oid, 'execute')
    FROM pg_proc p WHERE p.oid='public.fn_ca_promo_profit_settle(uuid,uuid)'::regprocedure
  """,'t')
  check('final release skips fee history',settlement_reads(released),'0')
  check('reviewed winnings override skips fee history',settlement_reads(overridden),'0')
  check('member without a grant skips fee history',settlement_reads(user=B),'0')
  check('open winnings gate still evaluates the original fee history',settlement_reads(),'1')
  principal_test=ROOT/'scripts/ci/test-promo-profit-payout-capacity.py';track(principal_test)
  principal_spec=importlib.util.spec_from_file_location('empty_principal',principal_test)
  principal=importlib.util.module_from_spec(principal_spec);principal_spec.loader.exec_module(principal)
  principal.verify(db,C,A,T,old,ROOT/'supabase/migrations/20261118021557_tournament_credit_checks_capacity_before_fee_history.sql',runfile,check)
  check('nonagent authoritative balance fields are both absent values',f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'agent_wallet') IS NULL AND (fn_ca_promo_play_through_summary('{C}','{A}')->>'agent_cashable') IS NULL",'t')
  check('original grant has one shared phase and original thresholds',f"SELECT count(*)||':'||max(principal_target)::integer||':'||max(profit_target)::integer FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{old}'",'1:200:100')
  fee(40)
  check('same actual fee progresses overlapping original thresholds',f"SELECT fees FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{old}'",'40')
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{old}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{old}';COMMIT")
  check('genuine total loss ends empty phase without future debt',f"SELECT count(*) FROM ca_promo_profit_fee_phases WHERE grant_id='{old}' AND closed_at IS NOT NULL",'1')
  new=gift(20);fee(80)
  check('later gift uses only its own remaining fee block',f"SELECT principal_state FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{new}'",'met_pending')
  check('actual fee event persists earned two-times finality',f"SELECT unlocked_at IS NOT NULL FROM ca_promo_profit_gates WHERE grant_id='{new}'",'t')
  db.run(f"SELECT fn_ca_promo_play_through_settle('{C}','{A}')")
  check('later principal earns original final unlock',f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{new}'",'met')
  # Isolated exact later earning source opening. The original source producer
  # constructor is qualified separately; no ordinary credit may call it.
  source=str(uuid.uuid4())
  db.run(f"INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES('{old}','bbj','{source}');INSERT INTO ca_promo_profit_custody VALUES('{old}','{C}','{A}','player_wallet','{A}',30)")
  check('late source starts behind already-earned intervening gift',f"SELECT fee_start=120 AND profit_earned=40 FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{old}' AND phase_kind='bbj'",'t')
  fee(59)
  check('late source retains original progress but has not met two-times',f"SELECT profit_state FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{old}' AND phase_kind='bbj'",'locked')
  fee(1)
  check('all same-grant phases share one original two-times target',f"SELECT unlocked_at IS NOT NULL FROM ca_promo_profit_gates WHERE grant_id='{old}'",'t')
  check('final release frees W without reopening original principal',f"SELECT fn_ca_promo_profit_locked_at('{C}','{A}','player_wallet','{A}')||':'||(SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{old}')",'0:spent')
  overlap_grant=gift(5);case=str(uuid.uuid4())
  db.run(f"UPDATE club_members SET chip_balance=100 WHERE club_id='{C}' AND user_id='{A}';UPDATE club_members SET role='owner' WHERE club_id='{C}' AND user_id='{B}';INSERT INTO agents VALUES('{C}','{A}',50);INSERT INTO ca_promo_profit_custody VALUES('{overlap_grant}','{C}','{A}','player_wallet','{A}',20);INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES('{case}',gen_random_uuid(),'{C}','{B}','{C}','{A}',20,jsonb_build_object('fixture','isolated accepted earning source'));INSERT INTO ca_promo_integrity_custody VALUES('{case}','{C}','{A}','player_wallet','{A}',20);INSERT INTO ca_promo_profit_integrity_overlap VALUES('{overlap_grant}','{case}','{C}','{A}','player_wallet','{A}',10)")
  check('cashable union counts same physical W and H amount once',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'",'65')
  check('payout bound covers exact retained W/H intersection',
        f"SELECT NOT fn_ca_promo_restrictions_exceed_capacity('{C}','{A}','player_wallet','{A}',35) AND fn_ca_promo_restrictions_exceed_capacity('{C}','{A}','player_wallet','{A}',34)",'t')
  check('even a large physical wallet cannot hide an invalid W/H intersection',f"""
    BEGIN;
    UPDATE ca_promo_profit_integrity_overlap SET amount=100 WHERE grant_id='{overlap_grant}' AND case_id='{case}';
    DO $$BEGIN BEGIN PERFORM fn_ca_promo_restrictions_exceed_capacity('{C}','{A}','player_wallet','{A}',10000);
      RAISE EXCEPTION 'invalid overlap escaped payout validation';
     EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'winnings_review_intersection_not_conserved' THEN RAISE;END IF;END;END$$;
    SELECT 'refused';ROLLBACK;""",'refused')

  db.run(f"SELECT fn_ca_promo_integrity_move('{C}','{A}','player_wallet','{A}','agent_wallet','{A}',15)")
  check('original per-case H movement preserves its exact W intersection',f"SELECT fn_ca_promo_profit_locked_at('{C}','{A}','agent_wallet','{A}')=5 AND fn_ca_promo_profit_overlap_at('{C}','{A}','agent_wallet','{A}')=5",'t')
  check('authoritative agent summary subtracts only the actual restricted union',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'agent_cashable'",'35')
  db.run(f"SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{case}','Original Source Reviewed')")
  check('review release never bypasses the original W gate',f"SELECT fn_ca_promo_profit_locked_at('{C}','{A}','agent_wallet','{A}')=5 AND fn_ca_promo_profit_overlap_at('{C}','{A}','agent_wallet','{A}')=0",'t')
  db.run(f"SELECT fn_ca_promo_profit_move_grant('{overlap_grant}','{C}','{A}','player_wallet','{A}','player_wallet','{A}',15,'{base.OTHER_CLUB}','{A}');UPDATE club_members SET chip_balance=30 WHERE club_id='{base.OTHER_CLUB}' AND user_id='{A}'")
  check('physical foreign wallet retains original earning club W gate',f"SELECT fn_ca_promo_profit_locked_at('{base.OTHER_CLUB}','{A}','player_wallet','{A}')",'15')
  check('foreign wallet summary reads original scope without treating own cash as W',f"SELECT fn_ca_promo_play_through_summary('{base.OTHER_CLUB}','{A}')->>'cashable'",'15')
  # Principal exhaustion is an explicit source opening, not proof
  # of the full financial leave owner (qualified separately with its journal).
  other_case=str(uuid.uuid4())
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{overlap_grant}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{overlap_grant}';INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES('{other_case}',gen_random_uuid(),'{C}','{B}','{C}','{A}',7,jsonb_build_object('fixture','independent original case'));INSERT INTO ca_promo_integrity_custody VALUES('{other_case}','{base.OTHER_CLUB}','{A}','player_wallet','{A}',7);COMMIT")
  check('existing reason-required support releases original W after principal exhaustion',f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_play_through_override('{C}','{A}','Source Reviewed By Original Club')->>'success'",'true')
  check('support override is immutable and never presented as earned two-times',f"SELECT EXISTS(SELECT 1 FROM ca_promo_profit_overrides WHERE grant_id='{overlap_grant}' AND reviewed_by='{B}') AND (SELECT unlocked_at IS NULL FROM ca_promo_profit_gates WHERE grant_id='{overlap_grant}')",'t')
  check('support W release leaves independent H intact in physical wallet',f"SELECT fn_ca_promo_play_through_summary('{base.OTHER_CLUB}','{A}')->>'cashable'",'23')
  check('support W override replay never creates another release receipt',f"SET ROLE authenticated;SET test.uid='{B}';SELECT fn_ca_promo_play_through_override('{C}','{A}','Same Source Reviewed')->>'unlocked_profit_grants'",'0')
  db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance) VALUES('{C}','{A}',10000) ON CONFLICT(club_id,user_id) DO UPDATE SET chip_balance=10000")
  refund_grant=gift(50);event=str(uuid.uuid4());charge=str(uuid.uuid4());entitlement=str(uuid.uuid4())
  context=json.dumps(dict(user_id=A,club_id=C,category='tournament_buyin',tournament_id=event,amount=1000,balance_before=10000,operation_key=charge))
  db.run(f"BEGIN;INSERT INTO tournaments VALUES('{event}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{event}','{A}','{C}');UPDATE club_members SET chip_balance=9000 WHERE club_id='{C}' AND user_id='{A}';SELECT set_config('app.ca_promo_wallet_debit','{context}',true);INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{charge}','player_wallet','{A}','prize_liability','{event}',1000,'tournament_buyin','{C}');INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{event}','{A}','{C}',1000,'{charge}',80);COMMIT")
  check('original paid entry fee progresses W before optional earning capture',f"SELECT profit_earned FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{refund_grant}' AND phase_kind='gift'",'80')
  db.run(f"INSERT INTO tournament_refund_tranches(entitlement_id,tournament_id,user_id,source_wallet_club_id,refund_fee) VALUES('{entitlement}','{event}','{A}','{C}',30)")
  check('exact original source refund reduces pre-met W progress',f"SELECT profit_earned FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{refund_grant}' AND phase_kind='gift'",'50')
  fee(50)
  check('remaining original paid fees earn the final W release once',f"SELECT unlocked_at IS NOT NULL FROM ca_promo_profit_gates WHERE grant_id='{refund_grant}'",'t')
  db.run(f"INSERT INTO tournament_refund_tranches(entitlement_id,tournament_id,user_id,source_wallet_club_id,refund_fee) VALUES('{entitlement}','{event}','{A}','{C}',50)")
  check('later source refund cannot reverse earned W finality',f"SELECT unlocked_at IS NOT NULL FROM ca_promo_profit_gates WHERE grant_id='{refund_grant}'",'t')
  check('W earned release leaves original four-times P target intact',f"SELECT principal_state='locked' AND principal_target=200 FROM fn_ca_promo_shared_fee_state('{C}','{A}') WHERE grant_id='{refund_grant}' AND phase_kind='gift'",'t')
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{refund_grant}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{refund_grant}';COMMIT")
  expired=gift(10);fee(5)
  db.run(f"UPDATE ca_promo_play_through_grants SET expires_at=clock_timestamp() WHERE id='{expired}'")
  next_gift=gift(10);fee(7)
  check('expired principal without W cannot lend dead two-times debt to new gift',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress'",'7')
  check('new four-times target excludes expired unearned old target',f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_target'",'40')
  check('expired original principal remains restricted for its real return',f"SELECT remaining=10 AND closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{expired}'",'t')
  no_expiry=gift(10)
  db.run(f"INSERT INTO ca_promo_profit_custody VALUES('{no_expiry}','{C}','{A}','player_wallet','{A}',10);UPDATE ca_promo_play_through_grants SET expires_at=clock_timestamp() WHERE id='{no_expiry}'")
  check('existing player-owned W does not expire with original principal',f"SELECT fn_ca_promo_profit_locked_at('{C}','{A}','player_wallet','{A}')",'10')
  visibility=ROOT/'tests/fixtures/promo-profit-source-visibility/native.py'
  track(visibility)
  runfile(ROOT/'supabase/migrations/20261118010644_promo_source_observation_preserves_original_transaction_visi.sql')
  source_spec=importlib.util.spec_from_file_location('promo_source_visibility',visibility)
  source_visibility=importlib.util.module_from_spec(source_spec)
  source_spec.loader.exec_module(source_visibility)
  source_visibility.qualify(db,check)
  # Actual accepted-source helpers execute on explicitly typed monetary frames;
  # the maintained full-hand proof separately invokes their engine DB owner.
  def cash_frame(before,after,other_before,other_after,investment,other_investment,insurance=None):
   hand=str(uuid.uuid4());stacks=json.dumps([dict(user_id=A,stack_before=before,stack=after),dict(user_id=B,stack_before=other_before,stack=other_after)])
   facts=json.dumps(dict(contributions={A:investment,B:other_investment},returned_uncalled={},insurance=insurance or []))
   participants=json.dumps([dict(user_id=x,funding_receipts=[dict(funding_club_id=C)]) for x in [A,B]])
   db.run(f"INSERT INTO hand_atomic_commits(hand_id,table_id,hand_number) VALUES('{hand}','{T}',{uuid.uuid4().int%1000000000});INSERT INTO cash_hand_provenance_receipts(table_id,hand_number,hand_id,payload_hash,accepted_request,atomic_receipt,stack_claim,stack_settlement,status,participants,all_players_included,funding_provenance_complete,issues) VALUES('{T}',{uuid.uuid4().int%1000000000},'{hand}','typed-accepted-frame','{{}}','{{}}','[]','[]','captured','{participants}',true,true,'[]');")
   return hand,stacks,facts
  def apply_frame(frame):
   hand,stacks,facts=frame
   db.run(f"BEGIN;SELECT fn_ca_promo_accept_cash_hand('{hand}','{T}','{stacks}','{facts}','{{}}');SELECT fn_ca_promo_integrity_accept_hand('{hand}','{T}','{stacks}','{facts}','{{}}',0);SELECT fn_ca_promo_profit_finish_cash('{hand}');COMMIT")
  gain_grant=gift(50)
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{gain_grant}';INSERT INTO ca_promo_principal_custody VALUES('{gain_grant}','table_stack','{T}',50);COMMIT")
  f=cash_frame(50,80,100,70,10,10);apply_frame(f)
  check('actual pure promo contested investment derives net gain once',f"SELECT amount FROM ca_promo_profit_custody WHERE grant_id='{gain_grant}' AND kind='table_stack'",'30')
  check('cash source marker closes complete positive capture',f"SELECT profit_capture_version FROM ca_promo_cash_hand_clocks WHERE hand_id='{f[0]}'",'1')
  apply_frame(f)
  check('accepted cash source replay cannot mint again',f"SELECT amount FROM ca_promo_profit_custody WHERE grant_id='{gain_grant}' AND kind='table_stack'",'30')
  # P is definitively lost while earned W survives: its old 2x gate remains.
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{gain_grant}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{gain_grant}';COMMIT")
  f=cash_frame(30,0,100,130,30,30);apply_frame(f)
  check('W-only heads-up dumping holds only exact recipient inflow',f"SELECT amount FROM ca_promo_integrity_cases WHERE hand_id='{f[0]}'",'30')
  check('W-only total loss retires exact original phase permanently',f"SELECT sum(profit_lost)::numeric(20,2)||':'||count(DISTINCT phase_id) FROM ca_promo_profit_cash_loss_slices WHERE hand_id='{f[0]}'",'30.00:1')
  check('W-only total loss cannot retain an empty future debt',f"SELECT count(*) FROM ca_promo_profit_fee_phases WHERE grant_id='{gain_grant}' AND closed_at IS NULL",'0')
  apply_frame(f)
  check('W-only dumping replay has one source review case',f"SELECT count(*) FROM ca_promo_integrity_cases WHERE hand_id='{f[0]}'",'1')
  # Clean chips alone funded the contested investment, despite promo on felt.
  clean_grant=gift(20)
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{clean_grant}';INSERT INTO ca_promo_principal_custody VALUES('{clean_grant}','table_stack','{T}',20);COMMIT")
  f=cash_frame(100,110,100,90,10,10);apply_frame(f)
  check('own cash investment with promo sitting idle produces authoritative zero W',f"SELECT count(*) FROM ca_promo_profit_cash_investment WHERE hand_id='{f[0]}'",'0')
  check('complete clean investment capture remains authoritative after raw pruning',f"SELECT profit_capture_version FROM ca_promo_cash_hand_clocks WHERE hand_id='{f[0]}'",'1')
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{clean_grant}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{clean_grant}';COMMIT")
  # Two actual accepted source projections intersect proportionally: A's
  # half-promo investment and B's lost promo source create W50/H50/O25.
  db.run(f"SET test.uid='{B}';SELECT fn_ca_promo_integrity_release(id,'Prior Source Reviewed') FROM ca_promo_integrity_cases WHERE recipient_id='{B}'")
  mixed=gift(50);donor_key=str(uuid.uuid4())
  db.run(f"UPDATE club_members SET chip_balance=10000 WHERE club_id='{C}' AND user_id='{B}';SELECT fn_ca_promo_play_through_record_grant('{C}','{B}',50,'club_promo','{donor_key}',NULL,'promo_wallet','{C}',NULL)")
  donor=db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{donor_key}'")
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id IN('{mixed}','{donor}');INSERT INTO ca_promo_principal_custody VALUES('{mixed}','table_stack','{T}',50),('{donor}','table_stack','{T}',50);COMMIT")
  f=cash_frame(100,200,100,0,100,100);apply_frame(f)
  check('mixed original investment attributes only its proportion of accepted profit',f"SELECT amount FROM ca_promo_profit_custody WHERE grant_id='{mixed}' AND kind='table_stack'",'50')
  check('new incoming review source intersects winnings at the same frozen fraction',f"SELECT fn_ca_promo_integrity_locked_at('{C}','{A}','table_stack','{T}')=50 AND fn_ca_promo_profit_overlap_at('{C}','{A}','table_stack','{T}')=25",'t')
  db.run(f"BEGIN;UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{mixed}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{mixed}';COMMIT")
  f=cash_frame(75,0,100,175,75,75);apply_frame(f)
  check('foreign recipient H movement retires its overlapping W rather than raising',f"SELECT sum(profit_lost)::numeric(20,2)||':'||sum(overlap_lost)::numeric(20,2) FROM ca_promo_profit_cash_loss_slices WHERE hand_id='{f[0]}'",'50.00:25.00')
  check('W/H gambling intersection is counted once in recipient hold',f"SELECT fn_ca_promo_integrity_locked_at('{C}','{B}','table_stack','{T}')",'75')
  # Immutable charge cost uses original case identity after a review, then
  # restores only the original player's W restriction on an exact refund.
  u=str(uuid.uuid4());key=str(uuid.uuid4());event=str(uuid.uuid4());charge=str(uuid.uuid4());entitlement=str(uuid.uuid4())
  c1='71000000-0000-0000-0000-000000000001';c2='71000000-0000-0000-0000-000000000002'
  db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{C}','{u}',100,'member');SELECT fn_ca_promo_play_through_record_grant('{C}','{u}',10,'club_promo','{key}',NULL,'promo_wallet','{C}',NULL)")
  g=db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'")
  db.run(f"SELECT fn_ca_promo_profit_credit_owned('cash_win',gen_random_uuid(),'{g}','{C}','{u}','player_wallet','{u}',40);INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES('{c1}',gen_random_uuid(),'{C}','{B}','{C}','{u}',10,'{{}}'),('{c2}',gen_random_uuid(),'{C}','{B}','{C}','{u}',10,'{{}}');INSERT INTO ca_promo_integrity_custody VALUES('{c1}','{C}','{u}','player_wallet','{u}',10),('{c2}','{C}','{u}','player_wallet','{u}',10);INSERT INTO ca_promo_profit_integrity_overlap VALUES('{g}','{c1}','{C}','{u}','player_wallet','{u}',5),('{g}','{c2}','{C}','{u}','player_wallet','{u}',5)")
  context=json.dumps(dict(user_id=u,club_id=C,category='tournament_buyin',tournament_id=event,amount=100,balance_before=100,operation_key=charge))
  db.run(f"BEGIN;INSERT INTO tournaments VALUES('{event}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{event}','{u}','{C}');UPDATE club_members SET chip_balance=0 WHERE club_id='{C}' AND user_id='{u}';SELECT set_config('app.ca_promo_wallet_debit','{context}',true);INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{charge}','player_wallet','{u}','prize_liability','{event}',100,'tournament_buyin','{C}');COMMIT")
  db.run(f"SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{c1}','Original First Case Reviewed Before Fee Recognition');INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{event}','{u}','{C}',100,'{charge}',10)")
  check('reviewed first case retains its exact original fee cost',f"SELECT case_id='{c1}' AND amount=2 FROM ca_promo_integrity_fee_slices WHERE charge_ledger_id='{charge}'",'t')
  check('review does not shift historical cost into second active case',f"SELECT fn_ca_promo_integrity_locked_at('{C}','{u}','event','{event}')",'10')
  check('W-only fee remains commission eligible and retires exact capital',f"SELECT profit_fee=3 AND overlap_fee=0 FROM ca_promo_profit_entry_fee_spends WHERE charge_ledger_id='{charge}'",'t')
  check('gross original fee progresses the existing target after all costs',f"SELECT remaining=9 AND fee_target=40 FROM ca_promo_play_through_grants WHERE id='{g}'",'t')
  check('original W source capital excludes the actually spent fee',f"SELECT remaining FROM ca_promo_profit_event_lots WHERE charge_ledger_id='{charge}'",'37')
  db.run(f"SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')")
  check('exact pre-met fee refund restores original W without a new gift',f"SELECT remaining FROM ca_promo_profit_event_lots WHERE charge_ledger_id='{charge}'",'40')
  check('reviewed first case remains released after fee refund',f"SELECT fn_ca_promo_integrity_locked_at('{C}','{u}','event','{event}')",'10')
  db.run(f"SELECT fn_ca_promo_integrity_restore_event_fees('{entitlement}')")
  check('exact fee refund replay cannot restore W twice',f"SELECT amount FROM ca_promo_profit_entry_fee_refunds WHERE entitlement_id='{entitlement}'",'3')
  # Gift and paid entry share one transaction. Ledger now() predates the
  # gift's clock_timestamp; only the original paid receipt is the fee clock.
  for amount,should_unlock in [(.5,True),(1,False)]:
   v=str(uuid.uuid4());key=str(uuid.uuid4());event=str(uuid.uuid4());charge=str(uuid.uuid4());entitlement=str(uuid.uuid4())
   context=json.dumps(dict(user_id=v,club_id=C,category='tournament_buyin',tournament_id=event,amount=1,balance_before=1,operation_key=charge))
   db.run(f"BEGIN;INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{C}','{v}',1,'member');SELECT fn_ca_promo_play_through_record_grant('{C}','{v}',{amount},'club_promo','{key}',NULL,'promo_wallet','{C}',NULL);INSERT INTO tournaments VALUES('{event}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{event}','{v}','{C}');UPDATE club_members SET chip_balance=0 WHERE club_id='{C}' AND user_id='{v}';SELECT set_config('app.ca_promo_wallet_debit','{context}',true);INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{charge}','player_wallet','{v}','prize_liability','{event}',1,'tournament_buyin','{C}');INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{event}','{v}','{C}',1,'{charge}',1);COMMIT")
   vg=db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'")
   check('same-transaction paid clock preserves original entry fee '+str(amount),f"SELECT g.granted_at>l.created_at AND p.earned_at>g.granted_at FROM ca_promo_play_through_grants g CROSS JOIN chip_ledger l CROSS JOIN ca_promo_event_fee_consumption_receipts p WHERE g.id='{vg}' AND l.id='{charge}' AND p.charge_ledger_id=l.id",'t')
   check('all-fee zero-risk original paid source retires P before finality '+str(amount),f"SELECT remaining=0 AND close_reason='spent' FROM ca_promo_play_through_grants WHERE id='{vg}'",'t')
   check('last paid fee reaches exact original two-times boundary '+str(amount),f"SELECT unlocked_at IS NOT NULL FROM ca_promo_profit_gates WHERE grant_id='{vg}'",'t' if should_unlock else 'f')
   original_source=str(uuid.uuid4())
   check('later exact zero-risk earning retains only its original gate '+str(amount),f"SELECT fn_ca_promo_profit_credit_owned('tournament_win','{original_source}','{vg}','{C}','{v}','player_wallet','{v}',100)",'0' if should_unlock else '100')
   if not should_unlock:
    check('late earning retains valid original paid fee without another target',f"SELECT max(profit_earned)=1 AND max(profit_target)=2 FROM fn_ca_promo_shared_fee_state('{C}','{v}') WHERE grant_id='{vg}'",'t')
  # Controls remain reachable in the original source club after physical move.
  v=str(uuid.uuid4());key=str(uuid.uuid4());ev_case=str(uuid.uuid4())
  db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{C}','{v}',0,'member'),('{base.OTHER_CLUB}','{v}',20,'member');SELECT fn_ca_promo_play_through_record_grant('{C}','{v}',1,'club_promo','{key}',NULL,'promo_wallet','{C}',NULL)")
  vg=db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'")
  db.run(f"BEGIN;SELECT fn_ca_promo_profit_credit_owned('bbj',gen_random_uuid(),'{vg}','{base.OTHER_CLUB}','{v}','player_wallet','{v}',10);UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id='{vg}';UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE id='{vg}';COMMIT")
  db.run(f"DO $$BEGIN BEGIN DELETE FROM club_members WHERE club_id='{C}' AND user_id='{v}';RAISE EXCEPTION 'source_membership_was_removed';EXCEPTION WHEN check_violation THEN IF SQLERRM<>'original_promo_winnings_requirement_must_be_resolved_before_leaving_club' THEN RAISE;END IF;END;END$$")
  check('original source membership cannot strand winnings held in another club',f"SELECT count(*) FROM club_members WHERE club_id='{C}' AND user_id='{v}'",'1')
  check('original club retains support route for physically foreign W only',f"SELECT (s->>'override_available')::boolean AND (s->>'profit_locked')::numeric=0 AND (s->>'wallet_profit_locked')::numeric=0 FROM (SELECT fn_ca_promo_play_through_summary('{C}','{v}')s)q",'t')
  db.run(f"INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES('{ev_case}',gen_random_uuid(),'{C}','{B}','{C}','{v}',0,'{{}}')")
  check('evidence-only unreviewed case remains reachable without holding cash',f"SELECT (s->>'integrity_review_available')::boolean AND (s->>'integrity_held')::numeric=0 FROM (SELECT fn_ca_promo_play_through_summary('{C}','{v}')s)q",'t')
  db.run(f"SET test.uid='{B}';SELECT fn_ca_promo_integrity_release('{ev_case}','Evidence Reviewed');SELECT fn_ca_promo_play_through_override('{C}','{v}','Original W Source Reviewed')")
  check('completed source controls disappear despite backend capability fields',f"SELECT NOT (s->>'integrity_review_available')::boolean AND NOT (s->>'override_available')::boolean FROM (SELECT fn_ca_promo_play_through_summary('{C}','{v}')s)q",'t')
  # Actual immutable source-table contract; its original earning producers
  # have their own full financial qualification. Only source openings are typed.
  generation=next((a.ticket_root/'supabase/migrations').glob('20261116200638_*.sql'));track(generation)
  gs=generation.read_text();db.run(gs[gs.index('CREATE TABLE public.ca_promo_profit_event_generations'):gs.index('CREATE FUNCTION public.fn_ca_promo_profit_generation_immutable')])
  section(ticket,'CREATE TABLE public.ca_promo_free_buy_funding_slices','CREATE FUNCTION public.fn_ca_promo_free_buy_funded()')
  v=str(uuid.uuid4());key=str(uuid.uuid4());event=str(uuid.uuid4());charge=str(uuid.uuid4());entitlement=str(uuid.uuid4());generation_id=str(uuid.uuid4());earning_id=str(uuid.uuid4());source_id=str(uuid.uuid4());obligation=str(uuid.uuid4());credit=str(uuid.uuid4())
  context=json.dumps(dict(user_id=v,club_id=C,category='tournament_buyin',tournament_id=event,amount=20,balance_before=20,operation_key=charge))
  db.run(f"BEGIN;INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{C}','{v}',20,'member');SELECT fn_ca_promo_play_through_record_grant('{C}','{v}',20,'club_promo','{key}',NULL,'promo_wallet','{C}',NULL);INSERT INTO tournaments VALUES('{event}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{event}','{v}','{C}');UPDATE club_members SET chip_balance=0 WHERE club_id='{C}' AND user_id='{v}';SELECT set_config('app.ca_promo_wallet_debit','{context}',true);INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{charge}','player_wallet','{v}','prize_liability','{event}',20,'tournament_buyin','{C}');INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{event}','{v}','{C}',20,'{charge}',2);COMMIT")
  vg=db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'");reg=db.one(f"SELECT id FROM tournament_players WHERE tournament_id='{event}' AND user_id='{v}'")
  db.run(f"INSERT INTO ca_promo_profit_event_generations(id,registration_id,tournament_id,user_id,earning_club_id,operation_ref) VALUES('{generation_id}','{reg}','{event}','{v}','{C}','typed original generation');INSERT INTO tournament_obligations VALUES('{obligation}','{event}','{v}',100,0,NULL);INSERT INTO ca_promo_profit_obligation_earnings(id,obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,earned_at) VALUES('{earning_id}','{obligation}','{event}','{v}','{C}','{generation_id}',ARRAY['{charge}'::uuid],0,100,'place',clock_timestamp());UPDATE tournaments SET status='COMPLETED' WHERE id='{event}'")
  check('terminal bank short retains exact original principal capital right',f"SELECT remaining=18 AND closed_at IS NULL FROM ca_promo_play_through_grants WHERE id='{vg}'",'t')
  check('canonical unpaid earning does not create a phantom W wallet hold',f"SELECT fn_ca_promo_profit_locked_at('{C}','{v}','player_wallet','{v}')",'0')
  db.run(f"INSERT INTO ca_promo_profit_earning_sources(source_id,operation_ref,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount,source_kind,source_obligation_id,earned_at) VALUES('{source_id}','typed source credit','{event}','{v}','{C}','{generation_id}',ARRAY['{charge}'::uuid],100,'place','{obligation}',clock_timestamp());INSERT INTO ca_promo_profit_earning_source_slices VALUES('{source_id}','{earning_id}',100,ARRAY['{charge}'::uuid],'{generation_id}')")
  check('after-fee original risk gets one conserved payout budget',f"SELECT sum(principal_amount)=100 AND sum(profit_amount)=0 AND sum(amount)=100 FROM fn_ca_promo_profit_event_cells('{source_id}')",'t')
  # Typed actual credit fact, then the real source projection runs. This does
  # not substitute for the separate original prize bank/journal producer proof.
  db.run(f"BEGIN;UPDATE club_members SET chip_balance=100 WHERE club_id='{C}' AND user_id='{v}';SET LOCAL session_replication_role=replica;INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{credit}','prize_liability','{event}','player_wallet','{v}',100,'fixture_original_credit','{C}');SET LOCAL session_replication_role=origin;INSERT INTO ca_promo_profit_earning_credit_links VALUES('{credit}','{source_id}');SELECT fn_ca_promo_profit_project_earning('{credit}','{source_id}','player_wallet','{v}');UPDATE tournament_obligations SET amount_paid=100 WHERE id='{obligation}';COMMIT")
  check('late exact original prize preserves 18P and derives 82W',f"SELECT fn_ca_promo_locked_at('{C}','{v}','player_wallet','{v}')=18 AND fn_ca_promo_profit_locked_at('{C}','{v}','player_wallet','{v}')=82",'t')
  db.run(f"SELECT fn_ca_promo_profit_project_earning('{credit}','{source_id}','player_wallet','{v}')")
  check('late source replay has one original-gift winnings receipt',f"SELECT count(*) FROM ca_promo_profit_realization_receipts WHERE source_kind='tournament_win' AND source_id='{credit}'",'1')
  def paid_source(promo=20,profit=0,held=0,intersection=0,price=20,entry_fee=2,wallet_amount=None):
   cash=price if wallet_amount is None else wallet_amount
   u,k,t,ch,en=map(lambda _:str(uuid.uuid4()),range(5));hc=str(uuid.uuid4())
   db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{C}','{u}',{cash},'member');SELECT fn_ca_promo_play_through_record_grant('{C}','{u}',{promo},'club_promo','{k}',NULL,'promo_wallet','{C}',NULL)")
   g=db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{k}'")
   if profit:db.run(f"SELECT fn_ca_promo_profit_credit_owned('cash_win',gen_random_uuid(),'{g}','{C}','{u}','player_wallet','{u}',{profit})")
   if held:db.run(f"INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence) VALUES('{hc}',gen_random_uuid(),'{C}','{B}','{C}','{u}',{held},'{{}}');INSERT INTO ca_promo_integrity_custody VALUES('{hc}','{C}','{u}','player_wallet','{u}',{held})")
   if intersection:db.run(f"INSERT INTO ca_promo_profit_integrity_overlap VALUES('{g}','{hc}','{C}','{u}','player_wallet','{u}',{intersection})")
   ctx=json.dumps(dict(user_id=u,club_id=C,category='tournament_buyin',tournament_id=t,amount=price,balance_before=cash,operation_key=ch))
   db.run(f"BEGIN;INSERT INTO tournaments VALUES('{t}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{t}','{u}','{C}');UPDATE club_members SET chip_balance={cash-price} WHERE club_id='{C}' AND user_id='{u}';SELECT set_config('app.ca_promo_wallet_debit','{ctx}',true);INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{ch}','player_wallet','{u}','prize_liability','{t}',{price},'tournament_buyin','{C}');INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{en}','{t}','{u}','{C}',{price},'{ch}',{entry_fee});COMMIT")
   return u,g,t,ch,hc
  def typed_earning(u,t,ch,amount,kind='place'):
   gen,er,src,cr=map(lambda _:str(uuid.uuid4()),range(4));reg=db.one(f"SELECT id FROM tournament_players WHERE tournament_id='{t}' AND user_id='{u}'")
   db.run(f"INSERT INTO ca_promo_profit_event_generations(id,registration_id,tournament_id,user_id,earning_club_id,operation_ref) VALUES('{gen}','{reg}','{t}','{u}','{C}','{gen}');INSERT INTO ca_promo_profit_obligation_earnings(id,operation_ref,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,earned_at) VALUES('{er}','{er}','{t}','{u}','{C}','{gen}',ARRAY['{ch}'::uuid],0,{amount},'{kind}',clock_timestamp());INSERT INTO ca_promo_profit_earning_sources(source_id,operation_ref,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount,source_kind,earned_at) VALUES('{src}','{src}','{t}','{u}','{C}','{gen}',ARRAY['{ch}'::uuid],{amount},'{kind}',clock_timestamp());INSERT INTO ca_promo_profit_earning_source_slices VALUES('{src}','{er}',{amount},ARRAY['{ch}'::uuid],'{gen}')")
   return src,cr
  u,g,t,ch,hc=paid_source(20,80,80,80,100,10);src,cr=typed_earning(u,t,ch,20)
  check('joint original P/W/H payout cells conserve one physical amount',f"SELECT sum(principal_amount)=4 AND sum(profit_amount)=16 AND sum(integrity_amount)=16 AND sum(overlap_amount)=16 AND sum(amount)=20 FROM fn_ca_promo_profit_event_cells('{src}')",'t')
  db.run(f"BEGIN;UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{u}';SET LOCAL session_replication_role=replica;INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{cr}','prize_liability','{t}','player_wallet','{u}',20,'fixture_original_credit','{C}');SET LOCAL session_replication_role=origin;INSERT INTO ca_promo_profit_earning_credit_links VALUES('{cr}','{src}');SET LOCAL track_functions='all';SELECT fn_ca_promo_profit_project_earning('{cr}','{src}','player_wallet','{u}');DO $$BEGIN IF coalesce(pg_stat_get_xact_function_calls('public.fn_ca_promo_restrictions_exceed_capacity(uuid,uuid,text,uuid,numeric)'::regprocedure),0)<>1 THEN RAISE EXCEPTION 'original tournament payout did not use its capacity check';END IF;END$$;COMMIT")
  check('mixed existing capital returns P4 W16 H16 overlap16 without doubleholding',f"SELECT fn_ca_promo_locked_at('{C}','{u}','player_wallet','{u}')=4 AND fn_ca_promo_profit_locked_at('{C}','{u}','player_wallet','{u}')=16 AND fn_ca_promo_integrity_locked_at('{C}','{u}','player_wallet','{u}')=16 AND fn_ca_promo_profit_overlap_at('{C}','{u}','player_wallet','{u}')=16 AND fn_ca_promo_restricted_at('{C}','{u}','player_wallet','{u}')=20",'t')
  # A real awarded asset carries derived W into the original earned-ticket
  # redemption callbacks. There is no purchased promo ticket or new gift.
  u,g,t,ch,hc=paid_source();src,cr=typed_earning(u,t,ch,100,'satellite_award');tk=str(uuid.uuid4());target=str(uuid.uuid4());redemption=str(uuid.uuid4());target_e=str(uuid.uuid4())
  db.run('ALTER TABLE tournament_tickets ADD COLUMN IF NOT EXISTS value numeric;')
  meta=json.dumps(dict(user_id=u,ticket_id=tk,kind='direct_satellite_entry_ticket'))
  db.run(f"BEGIN;INSERT INTO tournament_tickets(id,club_id,holder_id,value) VALUES('{tk}','{C}','{u}',100);SET LOCAL session_replication_role=replica;INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('{cr}','prize_liability','{t}','escrow','{tk}',100,'ticket_issue','{C}','{meta}');SET LOCAL session_replication_role=origin;INSERT INTO ca_promo_profit_earning_credit_links VALUES('{cr}','{src}');SELECT fn_ca_promo_profit_project_earning('{cr}','{src}','ticket','{tk}');COMMIT")
  check('earned satellite asset retains 18P plus actual82W',f"SELECT fn_ca_promo_locked_at('{C}','{u}','ticket','{tk}')=18 AND fn_ca_promo_profit_locked_at('{C}','{u}','ticket','{tk}')=82",'t')
  db.run(f"INSERT INTO tournaments VALUES('{target}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{target}','{u}','{C}')")
  target_reg=db.one(f"SELECT id FROM tournament_players WHERE tournament_id='{target}' AND user_id='{u}'");meta=json.dumps(dict(user_id=u,ticket_id=tk,registration_id=target_reg))
  db.run(f"BEGIN;INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('{redemption}','escrow','{tk}','prize_liability','{target}',100,'ticket_redeem','{C}','{meta}');INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{target_e}','{target}','{u}','{C}',100,'{redemption}',0);COMMIT")
  check('original earned-ticket entry carries W and freezes exact target source',f"SELECT fn_ca_promo_locked_at('{C}','{u}','event','{target}')=18 AND fn_ca_promo_profit_locked_at('{C}','{u}','event','{target}')=82 AND (SELECT original_profit=82 FROM ca_promo_profit_event_charge_receipts WHERE charge_ledger_id='{redemption}')",'t')
  check('earned asset redemption never creates another promo grant or target',f"SELECT count(*)=1 AND max(fee_target)=80 FROM ca_promo_play_through_grants WHERE user_id='{u}'",'t')
  # The actual full-gross returned-asset door must not wash W/H fee costs
  # into clean value or repeatedly earn fees that were returned in kind.
  u,g,t,ch,hc=paid_source(20,80,80,80,80,8,100);ret=str(uuid.uuid4());tk=str(uuid.uuid4());en=db.one(f"SELECT id FROM tournament_refund_entitlements WHERE source_ledger_id='{ch}'")
  db.run('ALTER TABLE tournament_tickets ADD COLUMN IF NOT EXISTS source_refund_entitlement_id uuid,ADD COLUMN IF NOT EXISTS redemption_mode text;')
  meta=json.dumps(dict(kind='tournament_entry_ticket_return',ticket_id=tk,entitlement_id=en,user_id=u,refund_fee=8))
  db.run(f"BEGIN;INSERT INTO tournament_tickets(id,club_id,holder_id,value,source_refund_entitlement_id,redemption_mode) VALUES('{tk}','{C}','{u}',80,'{en}','tournament_entry_only');INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('{ret}','prize_liability','{t}','escrow','{tk}',80,'ticket_issue','{C}','{meta}');COMMIT")
  check('original full-gross return restores W80 H80 and exactoverlap80',f"SELECT fn_ca_promo_profit_locked_at('{C}','{u}','ticket','{tk}')=80 AND fn_ca_promo_integrity_locked_at('{C}','{u}','ticket','{tk}')=80 AND fn_ca_promo_profit_overlap_at('{C}','{u}','ticket','{tk}')=80",'t')
  check('returned fee value cannot accumulate pre-met playthrough credit',f"SELECT max(profit_earned)=0 FROM fn_ca_promo_shared_fee_state('{C}','{u}') WHERE grant_id='{g}'",'t')
  db.run(f"SELECT fn_ca_promo_profit_return_entitlement_ticket('{ret}','{u}')")
  check('returned original ticket and cost witness are immutable once',f"SELECT count(*)=1 AND sum(fee)=8 FROM ca_promo_profit_ticket_fee_returns WHERE entitlement_id='{en}'",'t')
  h=str(uuid.uuid4());db.run(f"INSERT INTO ca_promo_cash_hand_clocks VALUES('{h}','{T}',1,clock_timestamp());INSERT INTO rake_attributions(club_id,player_id,rake_amount,hand_id) VALUES('{C}','{u}',40,'{h}')")
  db.run(f"INSERT INTO tournament_refund_tranches(entitlement_id,tournament_id,user_id,source_wallet_club_id,refund_fee) VALUES('{en}','{t}','{u}','{C}',8)")
  check('earned two-times stays final and later canonical reversal is deduplicated',f"SELECT (SELECT unlocked_at IS NOT NULL FROM ca_promo_profit_gates WHERE grant_id='{g}') AND max(profit_earned)=40 FROM fn_ca_promo_shared_fee_state('{C}','{u}') WHERE grant_id='{g}'",'t')
  # Actual Free Buy funding owner over the installed fee state. The same
  # cutoff row posts before and after its owner stops settling; each run
  # rolls back, so both start from one identical member and open grant.
  section(ticket,'CREATE FUNCTION public.fn_ca_promo_free_buy_funded()',"INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note) VALUES('chip_ledger','ca_promo_free_buy_funded'")
  db.run("ALTER TABLE chip_ledger ADD COLUMN IF NOT EXISTS tournament_id uuid,ADD COLUMN IF NOT EXISTS idempotency_key text;DO $$BEGIN IF to_regprocedure('public.fn_tournament_club_for_user(uuid,uuid,uuid)') IS NULL THEN CREATE FUNCTION public.fn_tournament_club_for_user(uuid,uuid,uuid) RETURNS uuid LANGUAGE sql AS 'SELECT $3';END IF;END$$")
  fu,fk,fe,fl=map(lambda _:str(uuid.uuid4()),range(4))
  db.run(f"INSERT INTO club_members(club_id,user_id,chip_balance,role) VALUES('{C}','{fu}',20,'member');SELECT fn_ca_promo_play_through_record_grant('{C}','{fu}',20,'club_promo','{fk}',NULL,'promo_wallet','{C}',NULL);INSERT INTO tournaments VALUES('{fe}','{C}','RUNNING');INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{fe}','{fu}','{C}');INSERT INTO smarter_private.free_buy_ticket_redemptions SELECT id,tournament_id,user_id,NULL FROM tournament_players WHERE tournament_id='{fe}'")
  free_buy_cutoff=f"""BEGIN;SET LOCAL track_functions='all';
   INSERT INTO chip_ledger(id,from_type,from_entity_id,from_label,to_type,to_entity_id,amount,category,club_id,tournament_id,idempotency_key,metadata)
    VALUES('{fl}','union_wallet','fade0000-0000-0000-0000-000000000001','union_wallets.promo_wallet','prize_liability','{fe}',1,'promo_send','{C}','{fe}','tourney:{fe}:free_buy_cutoff_funding','{{"kind":"midway_free_buy_promo_head","stage":"cutoff"}}');
   SELECT (COALESCE(pg_stat_get_xact_function_calls('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure),0)>0)::text||'|'||md5(jsonb_build_object(
    'grants',(SELECT jsonb_agg(jsonb_build_array(g.source_kind,g.source_ref,g.amount,g.remaining,g.multiplier,g.fee_target,g.source_ledger_id,g.funded_from_type,g.funded_from_id,g.closed_at IS NULL,g.close_reason,g.expires_at-g.granted_at,
      g.cycle_started_at=(SELECT o.cycle_started_at FROM ca_promo_play_through_grants o WHERE o.source_ref='{fk}')) ORDER BY g.source_ref) FROM ca_promo_play_through_grants g WHERE g.user_id='{fu}'),
    'custody',(SELECT jsonb_agg(jsonb_build_array(g.source_ref,c.kind,c.entity_id,c.amount) ORDER BY g.source_ref,c.kind,c.entity_id) FROM ca_promo_principal_custody c JOIN ca_promo_play_through_grants g ON g.id=c.grant_id WHERE g.user_id='{fu}'),
    'lots',(SELECT jsonb_agg(jsonb_build_array(g.source_ref,l.tournament_id,l.charge_ledger_id,l.source_ref,l.original_amount,l.remaining) ORDER BY l.source_ref) FROM ca_promo_event_principal_lots l JOIN ca_promo_play_through_grants g ON g.id=l.grant_id WHERE g.user_id='{fu}'),
    'slices',(SELECT jsonb_agg(to_jsonb(f)-'grant_id'||jsonb_build_object('grant',g.source_ref) ORDER BY g.source_ref) FROM ca_promo_free_buy_funding_slices f JOIN ca_promo_play_through_grants g ON g.id=f.grant_id WHERE g.user_id='{fu}'),
    'winnings',(SELECT jsonb_agg(jsonb_build_array(g.source_ref,w.unlocked_at IS NULL,p.source_kind,p.activated_at=g.granted_at,p.closed_at IS NULL) ORDER BY g.source_ref) FROM ca_promo_play_through_grants g JOIN ca_promo_profit_gates w ON w.grant_id=g.id JOIN ca_promo_profit_fee_phases p ON p.grant_id=g.id WHERE g.user_id='{fu}')
   )::text)||'|'||(SELECT count(*) FROM ca_promo_free_buy_funding_slices f JOIN ca_promo_play_through_grants g ON g.id=f.grant_id WHERE g.user_id='{fu}' AND f.amount=1);
   ROLLBACK;"""
  settled_post=db.one(free_buy_cutoff)
  if not(settled_post.startswith('true|') and settled_post.endswith('|1')):raise AssertionError('settling Free Buy owner did not read fee history for an open-grant entrant: '+settled_post)
  runfile(ROOT/'supabase/migrations/20261118031822_free_buy_grants_post_without_reading_fee_history.sql')
  check('Free Buy funding grant for an open-grant member reads no fee history and writes identical grant, custody, lot and slice rows',free_buy_cutoff,'false|'+settled_post.split('|',1)[1])
  lock_test=ROOT/'scripts/ci/test-promo-profit-cash-fee-lock.py';track(lock_test)
  import runpy
  runpy.run_path(str(lock_test))['verify'](db,C,T,ROOT/'supabase/migrations/20261118001328_cash_fee_settlement_never_waits_on_a_cashout_grant.sql',runfile,check)
  snapshot_test=ROOT/'scripts/ci/test-promo-profit-fee-state-snapshot.py';track(snapshot_test)
  runpy.run_path(str(snapshot_test))['verify'](db,C,T,B,ROOT/'supabase/migrations/20261119002019_promo_fee_state_is_read_from_an_hourly_snapshot.sql',runfile,check)
  for source,digest in input_hashes.items():
   if hashlib.sha256(Path(source).read_bytes()).hexdigest()!=digest:raise RuntimeError('source changed during qualification: '+source)
  report={'status':'passed','checks':checks,'production_mutations':False,'source_sha256':input_hashes,'qualification_limits':['Typed original funded gifts, H cases, W earning positions and cash fee openings; these checks qualify allocation/custody/authorization, not original earning producers, financial member departure or eventual jackpot payer. Notification callback uses an explicit invocation sink; actual notice delivery is separately qualified.']}
  (a.output/'RESULTS.json').write_text(json.dumps(report,indent=2)+'\n');print(str(len(checks))+' profit phase checks passed',flush=True)
 finally:
  if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','stop'],capture_output=True)
if __name__=='__main__':main()
