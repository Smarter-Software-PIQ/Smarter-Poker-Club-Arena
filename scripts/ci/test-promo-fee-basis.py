#!/usr/bin/env python3
"""Native PG17 promo earning basis, through actual source and rakeback owners.

Minimal typed relations isolate this arithmetic. Captured historical agreement,
cash accrual, commission guard, tournament source and rakeback calculator bodies
are real production owners. Wallet-payment guards are not modelled here; this
proves the liabilities and the real certified rakeback calculation, not payout.
No production endpoint, credentials, financial intent or remote DSN is accepted.
"""
import argparse,concurrent.futures,hashlib,importlib.util,json,os,shutil,subprocess,sys,tempfile
from decimal import Decimal,InvalidOperation
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FIXTURE=ROOT/'tests/fixtures/promo-fee-basis/accounting-owners.json'
MIGRATION=ROOT/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql'
C='c0000000-0000-0000-0000-000000000001';P='a0000000-0000-0000-0000-000000000001'
D='d0000000-0000-0000-0000-000000000001';U='d0000000-0000-0000-0000-000000000002'
DA='d1000000-0000-0000-0000-000000000001';UA='d1000000-0000-0000-0000-000000000002'
O='e0000000-0000-0000-0000-000000000001';T='70000000-0000-0000-0000-000000000001'
def uid(label):return str(__import__('uuid').UUID(hashlib.md5(label.encode()).hexdigest()))
def lit(v):return "'"+str(v).replace("'","''")+"'"
def js(v):return lit(json.dumps(v))+'::jsonb'
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--pg-bin',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
 if os.environ.get('DATABASE_URL'):raise SystemExit('remote database forbidden')
 if sys.platform=='darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
 a.output.mkdir(parents=True,exist_ok=False);scratch=Path(tempfile.mkdtemp(prefix='pf-'));pg=a.pg_bin.resolve();port='54421';started=False;checks=[];successful=False
 def q(s,error=None):
  p=subprocess.run([str(pg/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(scratch),'-p',port,'-U','postgres','-d','postgres'],input=s,text=True,capture_output=True,timeout=90)
  if error:
   if p.returncode==0 or error not in p.stderr:raise AssertionError((error,p.stdout,p.stderr))
  elif p.returncode:raise RuntimeError(p.stderr+'\n'+s[:500])
  return p.stdout.strip()
 def check(label,actual,expected):
  good=actual==expected
  if not good:
   try:good=Decimal(actual)==Decimal(expected)
   except(InvalidOperation,ValueError,TypeError):pass
  checks.append(dict(check=label,ok=good,actual=actual,expected=expected));print(('PASS 'if good else'FAIL ')+label,flush=True)
  if not good:raise AssertionError((label,actual,expected))
 def cash(label,promo=None,gross=100):
  rec,hand,leg=map(uid,(label,label+'hand',label+'bank'));at="transaction_timestamp()-interval '2 hours'"
  q(f"BEGIN;INSERT INTO rake_records(id,hand_id,club_id,created_at,rake_amount,is_tournament,metadata) VALUES('{rec}','{hand}','{C}',{at},{gross},false,'{{\"accounting_source_version\":\"2\",\"union_id\":null,\"is_private\":true}}');"
    f"INSERT INTO rake_attributions(id,rake_record_id,hand_id,club_id,player_id,rake_amount,weighted_rake_credit,created_at) VALUES('{uid(label+'attr')}','{rec}','{hand}','{C}','{P}',{gross},{gross},{at});"
    f"INSERT INTO chip_ledger(id,from_type,to_type,amount,club_id,category,created_at) VALUES('{leg}','table_stack','chip_retirement',{gross},'{C}','burn',{at});"
    f"INSERT INTO accounting_cash_bank_receipts(rake_record_id,club_id,amount,banked_at,club_ledger_id) VALUES('{rec}','{C}',{gross},{at},'{leg}');COMMIT;")
  if promo is not None:q(f"INSERT INTO ca_promo_cash_hand_funding VALUES('{hand}','{C}','{P}',100,{promo});")
  return rec,hand
 def accrue(hand):return q(f"SELECT fn_accrue_cash_hand_commissions('{hand}')")
 try:
  subprocess.run([pg/'initdb','-D',scratch/'data','-U','postgres','-A','trust'],check=True,capture_output=True)
  subprocess.run([pg/'pg_ctl','-D',scratch/'data','-w','-o',f"-p {port} -k {scratch} -c listen_addresses=''",'-l',scratch/'server.log','start'],check=True,capture_output=True);started=True
  q("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA smarter_private;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.role',true),'')$$;CREATE FUNCTION fn_caller_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT COALESCE(auth.role(),'service_role')='service_role'$$;CREATE FUNCTION fn_ca_launch_accounting_accepts(uuid,timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;")
  q('CREATE SEQUENCE hand_id_seq;')
  for r in json.loads((ROOT/'scripts/ci/fixtures/unpaid-atomic-cash-contract-columns.json').read_text()):q('CREATE TABLE '+r['table_name']+'('+r['columns']+')')
  q('ALTER TABLE accounting_cash_rake_sources ADD PRIMARY KEY(id);CREATE UNIQUE INDEX ON accounting_cash_accrual_batches(rake_record_id);CREATE UNIQUE INDEX ON agent_commissions(user_id,source_id,source_type) WHERE source_id IS NOT NULL;CREATE TABLE clubs(id uuid PRIMARY KEY,owner_id uuid,is_union boolean,union_id uuid);')
  q("CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY,enforced_from timestamptz);INSERT INTO ca_promo_play_through_settings VALUES(true,NULL);CREATE TABLE ca_promo_cash_hand_funding(hand_id uuid,club_id uuid,user_id uuid,contribution numeric,promo_contribution numeric,PRIMARY KEY(hand_id,club_id,user_id));CREATE TABLE tournament_tickets(id uuid PRIMARY KEY,club_id uuid,holder_id uuid);")
  q("CREATE TABLE accounting_cash_atomic_contract_admissions(source_id uuid PRIMARY KEY,admitted_contract jsonb,admitted_at timestamptz);CREATE TABLE accounting_cash_funding_contract_admissions(source_id uuid PRIMARY KEY,funding_club_id uuid,admitted_contract jsonb,admitted_at timestamptz);CREATE TABLE accounting_own_agent_interpretations(source_type text,source_id uuid,admitted_contract jsonb,admitted_at timestamptz);")
  q("CREATE TABLE accounting_tournament_fee_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rake_record_id uuid,tournament_id uuid,player_id uuid,club_id uuid,union_id uuid,coordinator_union_id uuid,game_type text,registration_id uuid,source_charge_ledger_id uuid,source_entitlement_id uuid,charged_at timestamptz,rake_credit numeric,contract jsonb,recorded_at timestamptz DEFAULT clock_timestamp());CREATE TABLE accounting_tournament_recognized_sources(source_id uuid,tournament_id uuid,recognized_at timestamptz,disposition text,rake_credit numeric);CREATE TABLE accounting_tournament_fee_recognitions(tournament_id uuid PRIMARY KEY,recognized_at timestamptz,status text,union_id uuid);CREATE TABLE accounting_tournament_fee_batches(rake_record_id uuid PRIMARY KEY,tournament_id uuid,source_fingerprint text,rake_amount numeric,source_manifest jsonb);CREATE TABLE accounting_tournament_fee_owner_bases(tournament_id uuid,transaction_id bigint,operation_id uuid,basis_kind text,completed_at timestamptz,hosting_club_id uuid);CREATE TABLE accounting_tournament_fee_cutover(singleton boolean,starts_at timestamptz);INSERT INTO accounting_tournament_fee_cutover VALUES(true,now()-interval '2 days');CREATE TABLE tournaments(id uuid PRIMARY KEY,club_id uuid,union_id uuid,is_private boolean,tournament_type text);CREATE TABLE tournament_players(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,club_id uuid);CREATE TABLE tournament_refund_entitlements(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,refund_wallet_club_id uuid,source_ledger_id uuid,created_at timestamptz,gross numeric,refund_fee numeric,entitlement_kind text,charge_category text,registration_id uuid,source_ticket_id uuid,source_satellite_id uuid);")
  q("CREATE FUNCTION fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;CREATE FUNCTION fn_ca_launch_accounting_club_cutoffs() RETURNS TABLE(club_id uuid,cutoff_at timestamptz) LANGUAGE sql STABLE AS $$SELECT NULL::uuid,NULL::timestamptz WHERE false$$;CREATE FUNCTION smarter_private.own_agent_destination_contract(jsonb,uuid,uuid,timestamptz) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT NULL::jsonb$$;CREATE FUNCTION smarter_private.ensure_rakeback_payer_contracts(bigint) RETURNS void LANGUAGE sql AS $$SELECT$$;")
  rel=json.loads((ROOT/'scripts/ci/fixtures/rakeback-cascade-real-guards/production-relations.json').read_text())['public.accounting_rakeback_period_calculations']
  sys.path.insert(0,str(ROOT/'scripts/ci/fixtures/rakeback-cascade-real-guards'));import world
  seqs,tabs,defaults,cons,indexes,_,_=world.tables_sql({'public.accounting_rakeback_period_calculations':rel})
  q('\n'.join(seqs+tabs+defaults+cons+indexes))
  captured=json.loads(FIXTURE.read_text())
  q((ROOT/'tests/fixtures/promo-fee-basis/owner-basis-dependency.sql').read_text())
  for r in captured['functions']:
   q(r['definition']);check('captured owner '+r['signature'],q("SELECT md5(pg_get_functiondef("+lit(r['signature'])+'::regprocedure))'),r['md5'])
   q('REVOKE ALL ON FUNCTION '+r['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
   for acl in (r['acl'] or '{}').strip('{}').split(','):
    if acl.startswith(('anon=','authenticated=','service_role=')):q('GRANT EXECUTE ON FUNCTION '+r['signature']+' TO '+acl.split('=')[0])
  admission=json.loads((ROOT/'tests/fixtures/promo-fee-basis/mtt-admission-guard.json').read_text())
  q(admission['definition']);q('REVOKE ALL ON FUNCTION public.fn_ca_guard_mtt_admission_contract() FROM PUBLIC,anon,authenticated,service_role;')
  check('actual admission guard preimage is preserved before the migration',q("SELECT md5(pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure))"),admission['md5'])
  for name in ['accounting_effective_cash_rake_sources','accounting_effective_tournament_fee_sources','accounting_payable_earning_sources']:
   r=next(r for r in captured['views'] if r['relname']==name);q('CREATE VIEW public.'+name+' AS '+r['definition'])
  q('CREATE TRIGGER commission_source_guard BEFORE INSERT ON agent_commissions FOR EACH ROW EXECUTE FUNCTION fn_accounting_cash_commission_source_guard();')
  q((ROOT/'tests/fixtures/promo-fee-basis/tournament-commission-guard.sql').read_text())
  q('CREATE TRIGGER tournament_commission_source_guard BEFORE INSERT ON agent_commissions FOR EACH ROW EXECUTE FUNCTION fn_accounting_tournament_commission_source_guard();')
  q(f"INSERT INTO clubs VALUES('{C}','{O}',false,NULL);INSERT INTO accounting_cash_accrual_cutover VALUES(true,now()-interval '2 days');")
  member=dict(club_id=C,user_id=P,role='member',status='active',is_active=True,agent_id=D,player_rakeback_pct=0.2,player_rakeback_explicit=True)
  direct=dict(id=DA,club_id=C,user_id=D,role='agent',status='active',commission_rate=.5,player_rakeback_rate=.2,parent_agent_id=UA)
  upper=dict(id=UA,club_id=C,user_id=U,role='super_agent',status='active',commission_rate=.2,player_rakeback_rate=0,parent_agent_id=None)
  for kind,key,terms in [('club_members',C+':'+P,member),('agents',DA,direct),('agents',UA,upper)]:
   q(f"INSERT INTO accounting_agreement_history(entity_type,entity_key,club_id,subject_user_id,observed_at,event_type,after_terms) VALUES('{kind}','{key}','{C}','{terms['user_id']}',now()-interval '3 hours','INSERT',{js(terms)});")
  for v in [direct,upper]:q(f"INSERT INTO agents(id,user_id,club_id,role,commission_rate,player_rakeback_rate,lifetime_rake_generated,weekly_rake_generated) VALUES('{v['id']}','{v['user_id']}','{C}','{v['role']}',{v['commission_rate']},{v['player_rakeback_rate']},0,0)")
  mixed,hm=cash('mixed',50);full,hf=cash('full',100);real,hr=cash('real')
  check('baseline pays commission on gross promo-funded rake',q(f"SELECT (fn_accounting_cash_commission_plan('{mixed}')->'players'->0->'tiers'->0->>'amount')::numeric"),'50.00')
  q('ALTER TABLE ca_promo_cash_hand_funding RENAME TO fixture_pre_custody;')
  def guarded(sql):
   # Use the real protected applier's before/after guard, not an imitation.
   script="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
   return subprocess.run(['node','--input-type=module','-e',script,str(MIGRATION)],input=sql,text=True,capture_output=True,check=True,cwd=ROOT).stdout
  migration=MIGRATION.read_text();pin_start=migration.index('DO $admission_pin$');pin_end=migration.index('END $admission_pin$;',pin_start)+len('END $admission_pin$;')
  q(guarded(migration[:pin_start]+migration[pin_end:]),'migration_left_a_stale_pin')
  check('real stale-pin guard refuses the former migration and rolls back all new funding DDL',q("SELECT to_regclass('public.ca_promo_entry_fee_funding') IS NULL"),'t')
  q(guarded(migration))
  next_hash=q("SELECT md5(pg_get_functiondef('public.fn_capture_accounting_tournament_fee(uuid,jsonb)'::regprocedure))")
  expected=admission['definition'].replace('e83638c8e5401469c336fe378505fbac',next_hash)
  check('admission guard changes only the exact earning-owner body pin',q("SELECT md5(pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure))"),hashlib.md5(expected.encode()).hexdigest())
  check('admission guard owner and original private ACL remain unchanged',q("SELECT pg_get_userbyid(proowner)||':'||proacl::text FROM pg_proc WHERE oid='public.fn_ca_guard_mtt_admission_contract()'::regprocedure"),admission['owner']+':'+admission['acl'])
  check('installs and reads safely before custody table while enforcement is off',q(f"SELECT fn_accounting_cash_commission_plan('{mixed}')->'players'->0->'tiers'->0->>'amount'"),'50.00')
  q("ALTER TABLE fixture_pre_custody RENAME TO ca_promo_cash_hand_funding;UPDATE ca_promo_play_through_settings SET enforced_from=now()-interval '1 day';")
  check('mixed source still records full gross credit',q(f"SELECT fn_accounting_cash_commission_plan('{mixed}')->'players'->0->>'rake_credit'"),'100')
  check('mixed promo fee cuts only eligible commission',q(f"SELECT fn_accounting_cash_commission_plan('{mixed}')->'players'->0->'tiers'->0->>'amount'"),'25.00')
  check('all promo fee earns zero commission',q(f"SELECT fn_accounting_cash_commission_plan('{full}')->'players'->0->'tiers'->0->>'amount'"),'0.00')
  # A failure after the first tier must roll back its source and batch too.
  q("CREATE FUNCTION fixture_commission_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF current_setting('fixture.fail',true)='yes' AND NEW.user_id='"+U+"'::uuid THEN RAISE EXCEPTION 'fixture_second_tier_refusal';END IF;RETURN NEW;END$$;CREATE TRIGGER fixture_commission_failure BEFORE INSERT ON agent_commissions FOR EACH ROW EXECUTE FUNCTION fixture_commission_failure();")
  q(f"BEGIN;SET LOCAL fixture.fail='yes';SELECT fn_accrue_cash_hand_commissions('{hm}');COMMIT;",'fixture_second_tier_refusal')
  check('failed original accrual leaves no source or commission',q('SELECT (SELECT count(*) FROM accounting_cash_rake_sources)+(SELECT count(*) FROM agent_commissions)'), '0')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   for result in list(pool.map(accrue,[hm,hm])):pass
  accrue(hf);accrue(hr)
  check('concurrent duplicate original accrual records one batch',q(f"SELECT count(*) FROM accounting_cash_accrual_batches WHERE hand_id='{hm}'"),'1')
  check('three cash sources conserve full gross bank credit',q('SELECT sum(rake_credit) FROM accounting_cash_rake_sources'),'300')
  check('actual commission owner posts only eligible tiers',q('SELECT sum(amount) FROM agent_commissions'),'90.00')
  check('canonical rakeback basis excludes promo fees',q('SELECT sum(rake_credit) FROM accounting_payable_earning_sources'),'150.00')
  check('gross source contracts still conserve the original bank',q("SELECT bool_and((contract->>'club_residual')::numeric+(SELECT COALESCE(sum((t->>'amount')::numeric),0) FROM jsonb_array_elements(contract->'tiers')t)=rake_credit) FROM accounting_cash_rake_sources"),'t')
  before=q("SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM accounting_cash_rake_sources s");accrue(hm)
  check('original accrual replay never reprices immutable sources',q("SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM accounting_cash_rake_sources s"),before)
  check('excluded half-cent rounds once and remains conserved',q("SELECT fn_ca_promo_payable_contract('{\"rake_credit\":0.01,\"tiers\":[]}',round(0.01*0.5,2))->>'payable_rake_credit'"),'0.00')
  check('reapplying effective contract never doubles exclusion',q(f"SELECT fn_ca_promo_cash_payable_contract('{mixed}','{C}','{P}',contract)=contract FROM accounting_cash_rake_sources WHERE rake_record_id='{mixed}'"),'t')
  # A canonical later interpretation must retain the original funding cut.
  q(f"INSERT INTO accounting_own_agent_interpretations VALUES('cash_rake_accrual',(SELECT id FROM accounting_cash_rake_sources WHERE rake_record_id='{mixed}'),fn_accounting_earning_contract('{C}','{P}',100,NULL,now()-interval '2 hours'),clock_timestamp())")
  check('later agreement interpretation cannot restore promo earnings',q(f"SELECT contract->'tiers'->0->>'amount' FROM accounting_effective_cash_rake_sources WHERE rake_record_id='{mixed}'"),'25.00')
  period=q("SELECT to_char(now() AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD')")
  q(f"SELECT fn_rakeback_split_write('{C}','{period}','{period}',ARRAY['{P}'::uuid])")
  check('actual rakeback calculator writes only real-funded entitlement',q('SELECT rakeback_amount FROM rakeback_periods'),'30.00')
  q(f"SELECT fn_rakeback_split_write('{C}','{period}','{period}',ARRAY['{P}'::uuid])")
  check('rakeback replay retains one original certificate',q('SELECT count(*) FROM accounting_rakeback_period_calculations'),'1')
  for role in ['anon','authenticated','service_role']:
   q(f"SET ROLE {role};SELECT fn_ca_promo_capture_entry_funding('{uid('none')}',0);",'permission denied')
  q('GRANT SELECT ON accounting_payable_earning_sources TO service_role;SET ROLE service_role;SELECT sum(rake_credit) FROM accounting_payable_earning_sources;')
  check('backend can read the qualified payable source',q('SELECT sum(rake_credit) FROM accounting_payable_earning_sources'),'150.00')
  q(f"INSERT INTO tournaments VALUES('{T}','{C}',NULL,true,'mtt');")
  def entry(label,promo,*,category='tournament_buyin',capture=True,fee_source='fn_register_for_tournament'):
   charge,registration,entitlement,record=map(uid,(label+'charge',label+'registration',label+'entitlement',label+'fee'))
   kind='tournament_entry_fee' if category=='tournament_buyin' else 'tournament_rebuy_fee'
   capture_sql=f"SELECT fn_ca_promo_capture_entry_funding('{charge}',{promo});" if capture else ''
   source=f"""BEGIN;
    INSERT INTO tournament_players VALUES('{registration}','{T}','{P}','{C}');
    INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,created_at)
     VALUES('{charge}','player_wallet','{P}','prize_liability','{T}',100,'{category}','{C}',transaction_timestamp());
    INSERT INTO tournament_refund_entitlements VALUES('{entitlement}','{T}','{P}','{C}','{charge}',transaction_timestamp(),100,10,'wallet_charge','{category}','{registration}',NULL,NULL);
    {capture_sql}
    INSERT INTO rake_records(id,club_id,rake_amount,is_tournament,tournament_id,source,metadata,created_at)
    VALUES('{record}','{C}',10,true,'{T}','{fee_source}',jsonb_build_object('kind','{kind}','user_id','{P}','registration_id','{registration}','accounting_source_version','2',
      'accounting_fee_source',jsonb_build_object('union_id',NULL,'game_type','mtt','contributors',jsonb_build_array(jsonb_build_object(
       'player_id','{P}','club_id','{C}','registration_id','{registration}','charge_ledger_id','{charge}','entitlement_id','{entitlement}','charged_at',transaction_timestamp(),'weight',10)))),transaction_timestamp());
    SELECT fn_capture_accounting_tournament_fee('{record}',NULL);
    COMMIT;"""
   return charge,record,source
  missing,missing_record,missing_sql=entry('missing',0,capture=False)
  q(missing_sql,'original_promo_entry_funding_missing')
  check('uncaptured post-live paid entry rolls back its charge',q(f"SELECT count(*) FROM chip_ledger WHERE id='{missing}'"),'0')
  ec,er,source=entry('entry-mixed',50);q(source)
  check('original tournament fee producer keeps full gross credit',q(f"SELECT rake_credit FROM accounting_tournament_fee_sources WHERE rake_record_id='{er}'"),'10')
  check('entry fee contract excludes exact original promo share',q(f"SELECT contract->>'payable_rake_credit' FROM accounting_tournament_fee_sources WHERE rake_record_id='{er}'"),'5.00')
  check('original entry replay does not add another source',q(f"SELECT fn_capture_accounting_tournament_fee('{er}',NULL)->>'replayed'"),'true')
  q(f"SELECT fn_ca_promo_capture_entry_funding('{ec}',50)")
  q(f"SELECT fn_ca_promo_capture_entry_funding('{ec}',49)",'original_promo_entry_funding_conflict')
  q(f"UPDATE ca_promo_entry_fee_funding SET promo_amount=0 WHERE charge_ledger_id='{ec}'",'original_promo_entry_funding_is_immutable')
  check('entry funding remains immutable after replay and conflict',q(f"SELECT promo_amount FROM ca_promo_entry_fee_funding WHERE charge_ledger_id='{ec}'"),'50')
  # Recognition is a typed terminal fixture, outside this change. Its real
  # source/commission guards and canonical view still require matching rows.
  q(f"BEGIN;INSERT INTO accounting_tournament_fee_recognitions VALUES('{T}',transaction_timestamp(),'recognized',NULL);INSERT INTO accounting_tournament_recognized_sources SELECT id,tournament_id,transaction_timestamp(),'earned',rake_credit FROM accounting_tournament_fee_sources WHERE rake_record_id='{er}';SELECT fn_post_accounting_commission_source(id,'tournament_fee_accrual',transaction_timestamp(),contract) FROM accounting_tournament_fee_sources WHERE rake_record_id='{er}';COMMIT;")
  check('recognized mixed entry posts only eligible commission',q(f"SELECT sum(amount) FROM agent_commissions WHERE source_type='tournament_fee_accrual'"),'3.00')
  check('recognized mixed fee enters rakeback at eligible basis',q("SELECT sum(rake_credit) FROM accounting_payable_earning_sources WHERE source_type='tournament_fee_accrual'"),'5.00')
  rc,rr,source=entry('entry-refunded',100);q(source)
  q(f"INSERT INTO accounting_tournament_recognized_sources SELECT id,tournament_id,(SELECT recognized_at FROM accounting_tournament_fee_recognitions WHERE tournament_id='{T}'),'refunded',rake_credit FROM accounting_tournament_fee_sources WHERE rake_record_id='{rr}'")
  check('refunded promo entry never enters payable earnings',q(f"SELECT count(*) FROM accounting_payable_earning_sources WHERE rake_record_id='{rr}'"),'0')
  q(f"SELECT fn_rakeback_split_write('{C}','{period}','{period}',ARRAY['{P}'::uuid])")
  check('actual calculator includes only five eligible tournament fee chips',q('SELECT rakeback_amount FROM rakeback_periods'),'31.00')
  initial=(ROOT/'supabase/migrations/20261115210559_promo_play_through_lock_ledger_and_fee_meter.sql').read_text()
  start=initial.index('CREATE FUNCTION public.fn_ca_promo_play_through_fees_between(')
  end=initial.index('$function$;',start)+len('$function$;');q(initial[start:end])
  q(f"INSERT INTO rake_records(id,club_id,rake_amount,is_tournament,tournament_id,metadata) VALUES('{uid('refund')}', '{C}',-10,true,'{T}',jsonb_build_object('user_id','{P}'))")
  check('actual 4x fee meter keeps gross cash and removes refunded fee',q(f"SELECT fn_ca_promo_play_through_fees_between('{C}','{P}',now()-interval '1 day',clock_timestamp())"),'310')
  q(f"SELECT fn_ca_promo_capture_entry_funding('{uid('unknown')}',0)",'original_promo_entry_charge_missing')
  contract=q(f"SELECT contract FROM accounting_tournament_fee_sources WHERE rake_record_id='{er}'")
  q(f"SELECT fn_ca_promo_tournament_payable_contract('{ec}',{lit(contract)}::jsonb||jsonb_build_object('player_id','{D}'))",'promo_fee_original_payer_conflict')
  zc,zr,source=entry('entry-real',0);q(source)
  check('explicitly captured real entry retains full earning basis',q(f"SELECT COALESCE(contract->>'payable_rake_credit',contract->>'rake_credit') FROM accounting_tournament_fee_sources WHERE rake_record_id='{zr}'"),'10')
  bc,br,source=entry('rebuy-promo',100,category='rebuy',fee_source='process_tournament_rebuy');q(source)
  check('original paid rebuy excludes fully promo-funded fee',q(f"SELECT contract->>'payable_rake_credit' FROM accounting_tournament_fee_sources WHERE rake_record_id='{br}'"),'0.00')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   list(pool.map(lambda _:q(f"SELECT fn_ca_promo_capture_entry_funding('{zc}',0)"),range(2)))
  check('concurrent identical entry captures retain one receipt',q(f"SELECT count(*) FROM ca_promo_entry_fee_funding WHERE charge_ledger_id='{zc}'"),'1')
  old=uid('old-entry');q(f"INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,created_at) VALUES('{old}','player_wallet','{P}','prize_liability','{T}',100,'tournament_buyin','{C}',now()-interval '2 days')")
  old_contract=q(f"SELECT fn_accounting_earning_contract('{C}','{P}',10,NULL,now()-interval '2 hours')")
  check('pre-live entry basis remains unchanged without retroactive capture',q(f"SELECT COALESCE(fn_ca_promo_tournament_payable_contract('{old}',{lit(old_contract)}::jsonb)->>'payable_rake_credit',fn_ca_promo_tournament_payable_contract('{old}',{lit(old_contract)}::jsonb)->>'rake_credit')"),'10')
  q("SET ROLE authenticated;SELECT fn_accounting_cash_commission_plan('"+mixed+"');",'permission denied')
  q("SET request.jwt.claim.role='authenticated';SELECT fn_accounting_cash_commission_plan('"+mixed+"');",'service_role_required')
  successful=True
 finally:
  inputs=[Path(__file__).resolve(),FIXTURE,MIGRATION,ROOT/'tests/fixtures/promo-fee-basis/mtt-admission-guard.json',ROOT/'scripts/ci/migration-stale-pins.mjs',ROOT/'tests/fixtures/promo-fee-basis/owner-basis-dependency.sql',ROOT/'tests/fixtures/promo-fee-basis/tournament-commission-guard.sql',ROOT/'scripts/ci/fixtures/unpaid-atomic-cash-contract-columns.json',ROOT/'scripts/ci/fixtures/rakeback-cascade-real-guards/production-relations.json',ROOT/'scripts/ci/fixtures/rakeback-cascade-real-guards/world.py',ROOT/'supabase/migrations/20261115210559_promo_play_through_lock_ledger_and_fee_meter.sql']
  (a.output/'RESULTS.json').write_text(json.dumps({'status':'passed' if successful else 'failed','production_mutations':False,'checks':checks,'source_sha256':{str(x.relative_to(ROOT)):hashlib.sha256(x.read_bytes()).hexdigest() for x in inputs}},indent=2)+'\n')
  if started:subprocess.run([pg/'pg_ctl','-D',scratch/'data','-m','immediate','-w','stop'],capture_output=True)
  shutil.rmtree(scratch)
 print(str(len(checks))+' checks passed')
if __name__=='__main__':main()
