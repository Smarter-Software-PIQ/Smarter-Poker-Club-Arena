#!/usr/bin/env python3
"""Original noncash refund source/fund conservation under authentic financial guards."""
from pathlib import Path
FIRST=Path(__file__).resolve().parents[2]
BOOT_SOURCE=(FIRST/'scripts/ci/test-promo-principal-returns.py').read_text()
s=(FIRST/'scripts/ci/test-promo-principal-returns.py').read_text();s=s[:s.index(" seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql').read_text().split('SET LOCAL session_replication_role=origin;')[0]")].replace('root=Path(__file__).resolve().parents[2]','root=Path('+repr(str(FIRST))+')')
s=s.replace('args=p.parse_args();',"p.add_argument('--profit-source',type=Path,default=root/'supabase/migrations/20261116190221_promo_winnings_retain_original_source_until_two_times_paid_f.sql');args=p.parse_args();")
body=r'''
 db=bust_db
 originals=json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json').read_text())
 for row in originals:
  if row['proname']=='fn_ca_return_satellite_entitlement_as_ticket':e.sql(db,row['definition']+';',label='original-private-return-owner')
 for row in json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-target-dependency.json').read_text())+json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-admission-scope-dependencies.json').read_text())+json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-admission-dependencies.json').read_text())+json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-admission-owners.json').read_text()):
  e.sql(db,'SET check_function_bodies=off;'+row['definition']+';SET check_function_bodies=on;',label='actual-original-ticket-admission')
 import ast
 financial_path=root/'scripts/ci/test-promo-tournament-earning-financial.py';remember(financial_path)
 tree=ast.parse(financial_path.read_text());financial_body=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='body' for t in n.targets))
 financial_body=financial_body[:financial_body.index(" seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql')")]
 financial_body=financial_body.replace(' profit_root=proof_profit_root',' profit_root=root').replace('proof_runner','Path(__file__)').replace('generation=proof_migration','generation=next((args.ticket_tree/"supabase/migrations").glob("20261116200638_*.sql"))').replace("migration=next((profit_root/'supabase/migrations').glob(version+'_*.sql'))","migration=args.profit_source if version=='20261116190221' else next((profit_root/'supabase/migrations').glob(version+'_*.sql'))")
 exec(compile('if True:\n'+financial_body,'actual-full-H-W-generation','exec'))
 cap=json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-ticket-guards.json').read_text())[0]['catalog']
 # Exact original ticket guard plus counted store and deferred refusal.
 for row in cap['triggers']:
  if row['name'] in ('tournament_satellite_entry_ticket_is_guarded','zy_ca_tally_store_move','zz_ca_store_has_its_ledger_row'):
   if row['name']=='tournament_satellite_entry_ticket_is_guarded':e.sql(db,'SET check_function_bodies=off;'+row['function']+';SET check_function_bodies=on;',label='actual-ticket-guard')
   e.sql(db,'DROP TRIGGER IF EXISTS '+row['name']+' ON public.tournament_tickets;'+row['definition']+';',label='actual-ticket-trigger')
 companion=root/'supabase/migrations/20261116214149_returned_promo_ticket_principal_goes_to_its_original_fund_wi.sql';remember(companion)
 import subprocess
 wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
 guarded=subprocess.run(['node','--input-type=module','-e',wrapper,companion.name],input=companion.read_text(),text=True,capture_output=True,check=True,cwd=root).stdout
 _,inventory_before,_=e.sql(db,"SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))",label='inventory-source-before')
 _,guard_before,_=e.sql(db,"SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)",label='actual-admission-pin-before')
 _,acl_before,_=e.sql(db,"SELECT proowner::text||':'||proacl::text FROM pg_proc WHERE oid='public.fn_ca_guard_mtt_admission_contract()'::regprocedure",label='actual-admission-pin-acl-before')
 e.sql(db,guarded,label='maintained-original-ticket-split')
 _,inventory_after,_=e.sql(db,"SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))",label='inventory-source-after')
 _,guard_after,_=e.sql(db,"SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)",label='actual-admission-pin-after')
 _,admission_hash,_=e.sql(db,"SELECT md5(pg_get_functiondef('public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)'::regprocedure))",label='actual-new-admission-hash')
 _,acl_after,_=e.sql(db,"SELECT proowner::text||':'||proacl::text FROM pg_proc WHERE oid='public.fn_ca_guard_mtt_admission_contract()'::regprocedure",label='actual-admission-pin-acl-after')
 needle='"signature":"public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)","definition_md5":"8a9b893eeb07cbcf518782391e757c2c"'
 expected=guard_before.replace(needle,needle.replace('8a9b893eeb07cbcf518782391e757c2c',admission_hash.strip()))
 if guard_before.count(needle)!=1 or expected!=guard_after or acl_before!=acl_after or inventory_before!=inventory_after:raise RuntimeError('original source guard or ACL changed beyond exact admitted owner pin')
 e.report['native'].append({'case':'exact-admission-pin-only-and-inventory-unchanged','assertions':4})
 # A refunded entry keeps its promo on the ticket (20261123071237). The
 # bootstrap closure already installed the migration's wallet section up to
 # its ticket boundary; the rest installs here, byte for byte, over the
 # original split, whose body its preimage admits beside production's.
 keeps=next((root/'supabase/migrations').glob('20261123071237_*.sql'));remember(keeps)
 keep_text=keeps.read_text();keep_boundary='-- TICKET REFUND SECTION.'
 if keep_text.count(keep_boundary)!=1 or not keep_text.rstrip().endswith('COMMIT;'):raise SystemExit('keep migration ticket boundary changed')
 _,split_md5,_=e.sql(db,"SELECT md5(pg_get_functiondef('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)'::regprocedure))",label='original-ticket-split-md5')
 e.report['original_ticket_split_md5']=split_md5.strip()
 e.sql(db,"BEGIN;SET LOCAL lock_timeout = '2s';\n"+keep_text[keep_text.index(keep_boundary):],label='refunded-ticket-entry-keeps-promo')
 e.sql(db,"CREATE EXTENSION IF NOT EXISTS plpgsql_check;DO $$DECLARE f text;n int;BEGIN FOR f IN SELECT unnest(ARRAY['public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)','public.fn_ca_promo_restore_refunded_entry_cost(uuid,text,numeric,uuid,uuid)','public.fn_ca_promo_refund_successor_grant(uuid,numeric,text,text,uuid)']) LOOP SELECT count(*) INTO n FROM plpgsql_check_function_tb(f::regprocedure) c WHERE c.level='error';IF n<>0 THEN RAISE EXCEPTION 'plpgsql_check found % error(s) in %: %',n,f,(SELECT string_agg(c.message,' | ') FROM plpgsql_check_function_tb(f::regprocedure) c WHERE c.level='error');END IF;END LOOP;END$$;",label='keep-owners-plpgsql-check-clean')
 e.report['native'].append({'case':'keep-owners-plpgsql-check-clean','assertions':3})
 cross_open="   e.sql(fee_db,f"+chr(34)*3;cross_start=BOOT_SOURCE.index(cross_open+"BEGIN;SET LOCAL session_replication_role=replica;\n INSERT INTO public.clubs SELECT")+len(cross_open)
 cross_template=BOOT_SOURCE[cross_start:BOOT_SOURCE.index(chr(34)*3+",label='satellite-cross-original-refund-wallet-opening')",cross_start)]
 base=db
 seed_start=BOOT_SOURCE.index('  e.sql(fee_db,f"""BEGIN;\n SET LOCAL',BOOT_SOURCE.index(' for promo,closed,lost,cross'))+len('  e.sql(fee_db,f"""')
 seed_end=BOOT_SOURCE.index("\"\"\",label=label+'-source')",seed_start)
 seed_template=BOOT_SOURCE[seed_start:seed_end]
 for mode in ['met','active','lost','lapsed','crossclub','terminal']:
  db=e.database(base);event,charge,entitlement,record,source=[str(uuid.uuid4()) for _ in range(5)]
  promo=10 if mode in('active','crossclub') else 20;cross=True;wallet_club='20000000-0000-0000-0000-000000000099' if mode=='crossclub' else '20000000-0000-0000-0000-000000000001';fund_mode=mode in('lapsed','crossclub');source_user='30000000-0000-0000-0000-000000000001';source_type='prize_liability';source_meta=json.dumps({'user_id':'10000000-0000-0000-0000-000000000001','registration_id':entitlement});label='ticket-'+mode
  e.sql(db,"UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';",label='prospective-native-programme-on')
  if mode=='crossclub':e.sql(db,eval('f'+chr(34)*3+cross_template+chr(34)*3),label='ticket-cross-club-refund-wallet-opening')
  opening=eval('f'+chr(34)*3+seed_template+chr(34)*3)
  if mode=='terminal':opening=opening.replace("'status','REGISTERING'","'status','COMPLETED'")
  if mode=='active':
   injection=f""" SELECT public.fn_ca_promo_profit_credit_owned('cash_win','{source}',id,'{wallet_club}','10000000-0000-0000-0000-000000000001','event','{event}',10) FROM public.ca_promo_play_through_grants WHERE source_ref='{label}';
 INSERT INTO public.ca_promo_profit_event_charge_receipts VALUES('{charge}','{wallet_club}','10000000-0000-0000-0000-000000000001',10,0);
 INSERT INTO public.ca_promo_profit_event_lots SELECT id,'{charge}','{event}','{wallet_club}','10000000-0000-0000-0000-000000000001',10,10 FROM public.ca_promo_play_through_grants WHERE source_ref='{label}';
"""
   opening=opening.replace(" SELECT public.fn_ca_promo_consume_entry_fee",injection+" SELECT public.fn_ca_promo_consume_entry_fee")
   opening=opening.replace(" SET CONSTRAINTS ALL IMMEDIATE;COMMIT;",f" SELECT public.fn_ca_promo_profit_finish_entry_fee('{charge}'); SET CONSTRAINTS ALL IMMEDIATE;COMMIT;")
  e.sql(db,opening,label='original-paid-entry-'+mode)
  if mode=='met':
   e.sql(db,"BEGIN;UPDATE public.ca_promo_principal_custody SET amount=0;UPDATE public.ca_promo_event_principal_lots SET remaining=0;UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='met';COMMIT;",label='typed-final-earned-release')
  if mode in('lost','lapsed'):
   if mode=='lapsed':e.sql(db,"UPDATE public.ca_promo_play_through_grants SET expires_at=clock_timestamp()-interval '1 second';",label='typed-thirty-days-over')
   candidate=str(uuid.uuid4());e.sql(db,f"""BEGIN;INSERT INTO public.ca_promo_event_entry_loss_receipts(candidate_id,registration_id,tournament_id,club_id,user_id,table_id,hand_id,hand_number,operation_ref,principal,charge_ledger_ids) VALUES('{candidate}','{entitlement}','{event}','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',gen_random_uuid(),gen_random_uuid(),1,'typed-original-bust',18,ARRAY['{charge}'::uuid]);INSERT INTO public.ca_promo_event_entry_loss_slices SELECT '{candidate}',id,grant_id,charge_ledger_id,remaining FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id='{charge}';UPDATE public.ca_promo_event_principal_lots SET remaining=0;UPDATE public.ca_promo_principal_custody SET amount=0;UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent';COMMIT;""",label='typed-original-bust-opening')
  if mode=='terminal':
   e.sql(db,f"SELECT public.fn_ca_promo_profit_cleanup_settled_event('{event}','10000000-0000-0000-0000-000000000001');",label='actual-completed-event-cleanup')
   snapshot=f"""jsonb_build_object('fund',(SELECT to_jsonb(c) FROM public.clubs c WHERE id='{wallet_club}'),'member',(SELECT to_jsonb(m) FROM public.club_members m WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001'),'event',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='{event}'),'escrow',(SELECT to_jsonb(x) FROM public.tournament_escrow x WHERE tournament_id='{event}'),'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.ca_promo_play_through_grants g),'custody',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.grant_id,c.kind,c.entity_id) FROM public.ca_promo_principal_custody c),'lots',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.ca_promo_event_principal_lots c),'terminal',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.lot_id) FROM public.ca_promo_event_terminal_loss_slices c),'tickets',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.tournament_tickets t),'ledger',(SELECT count(*) FROM public.chip_ledger),'transactions',(SELECT count(*) FROM public.chip_transactions),'returns',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.entitlement_id,r.grant_id) FROM public.ca_promo_ticket_principal_fee_returns r))"""
   _,refusal,_=e.sql(db,f"""BEGIN;
INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
DO $$DECLARE before_state jsonb;refusal text;context text;blocked boolean;BEGIN
IF (SELECT status FROM public.tournaments WHERE id='{event}')<>'COMPLETED' THEN RAISE EXCEPTION 'terminal proof did not preserve completed event';END IF;
IF (SELECT sum(amount) FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id='{charge}')<>18 OR EXISTS(SELECT 1 FROM public.ca_promo_event_entry_loss_slices WHERE charge_ledger_id='{charge}') THEN RAISE EXCEPTION 'actual cleanup lacks disjoint original terminal eighteen';END IF;
IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE source_ref='{label}' AND remaining=0 AND close_reason='spent' AND closed_at IS NOT NULL AND fee_target=80) THEN RAISE EXCEPTION 'actual cleanup did not finally close original gift';END IF;
before_state:={snapshot};
FOR attempt IN 1..2 LOOP
 blocked:=false;
 BEGIN PERFORM public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original completed entry cannot be refunded');
 EXCEPTION WHEN SQLSTATE '55000' THEN
  GET STACKED DIAGNOSTICS refusal=MESSAGE_TEXT,context=PG_EXCEPTION_CONTEXT;
  IF context NOT LIKE '%fn_satellite_transfer_ledger_is_immutable()%' OR refusal<>'completed satellite transfer journal is immutable' THEN RAISE EXCEPTION 'wrong noncash terminal refusal: % %',refusal,context;END IF;
  blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'original terminal guard allowed a new noncash refund';END IF;
 IF {snapshot} IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'terminal refusal changed money, assets, journals or original closed gift';END IF;
END LOOP;
RAISE NOTICE 'Original terminal noncash refund safely refused: %',refusal;
END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-original-terminal-noncash-refusal')
   e.report['native'].append({'case':'actual-completed-cleanup-and-noncash-refusal','assertions':7})
   continue
  e.sql(db,"INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;",label='actual-authority-source')
  if fund_mode:
   e.sql(db,f"""BEGIN;
ALTER TABLE public.chip_ledger ADD CONSTRAINT ticket_return_native_fault CHECK(idempotency_key NOT LIKE 'promo_ticket_fee_return:%') NOT VALID;
DO $$BEGIN BEGIN PERFORM public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');RAISE EXCEPTION 'fault not reached';EXCEPTION WHEN check_violation THEN NULL;END;
IF EXISTS(SELECT 1 FROM public.tournament_tickets WHERE source_refund_entitlement_id='{entitlement}') OR EXISTS(SELECT 1 FROM public.ca_promo_ticket_principal_fee_returns) OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>{1050-promo} THEN RAISE EXCEPTION 'late journal fault retained asset/fund/receipt';END IF;END$$;
ALTER TABLE public.chip_ledger DROP CONSTRAINT ticket_return_native_fault;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-ticket-fault-'+mode)
   expected=10 if mode=='crossclub' else 20;face=10 if mode=='crossclub' else 0;own=10 if mode=='crossclub' else 0
   e.sql(db,f"""BEGIN;
SELECT public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
DO $$DECLARE ack jsonb;before_count int;BEGIN
IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>{1050-promo}+{expected} OR (SELECT sum(amount) FROM public.ca_promo_ticket_principal_fee_returns)<>{expected} THEN RAISE EXCEPTION 'wrong original fund return';END IF;
IF (SELECT CASE WHEN status='cancelled' THEN 0 ELSE value END FROM public.tournament_tickets WHERE source_refund_entitlement_id='{entitlement}')<>{face} THEN RAISE EXCEPTION 'wrong usable net asset';END IF;
IF EXISTS(SELECT 1 FROM public.tournament_refund_tranches) OR (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>{own} THEN RAISE EXCEPTION 'refund created personal cash';END IF;
IF (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE source_ref='{label}')<>{promo}*4 OR (SELECT closed_at FROM public.ca_promo_play_through_grants WHERE source_ref='{label}') IS NULL THEN RAISE EXCEPTION 'refund revived/repriced gift';END IF;
SELECT count(*) INTO before_count FROM public.chip_ledger;
ack:=public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
IF EXISTS(SELECT 1 FROM public.ca_promo_refund_keep_receipts) THEN RAISE EXCEPTION 'a grant the promo terms ended was kept';END IF;
IF (ack->>'value')::numeric<>{face} OR ack->>'replayed'<>'true' OR (SELECT count(*) FROM public.chip_ledger)<>before_count OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>{1050-promo}+{expected} THEN RAISE EXCEPTION 'original same intent replay changed effect';END IF;
END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-ticket-return-'+mode)
  if not fund_mode:
   G="(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='"+label+"')"
   T="(SELECT id FROM public.tournament_tickets WHERE source_refund_entitlement_id='"+entitlement+"')"
   state=f"""jsonb_build_object('fund',(SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}'),'wallet',(SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001'),'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.ca_promo_play_through_grants g),'custody',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.grant_id,c.kind,c.entity_id) FROM public.ca_promo_principal_custody c),'lots',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.ca_promo_event_principal_lots c),'tickets',(SELECT count(*) FROM public.tournament_tickets),'ledger',(SELECT count(*) FROM public.chip_ledger),'keeps',(SELECT count(*) FROM public.ca_promo_refund_keep_receipts),'returns',(SELECT count(*) FROM public.ca_promo_ticket_principal_fee_returns))"""
   # A failure while the keep receipt is written leaves no ticket, no restored
   # promo, no successor grant and no receipt behind.
   e.sql(db,f"""BEGIN;
ALTER TABLE public.ca_promo_refund_keep_receipts ADD CONSTRAINT ticket_keep_native_fault CHECK(amount<0) NOT VALID;
DO $$DECLARE before_state jsonb:={state};BEGIN BEGIN PERFORM public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');RAISE EXCEPTION 'fault not reached';EXCEPTION WHEN check_violation THEN NULL;END;
IF {state} IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'late keep-receipt fault retained asset, promo or receipt';END IF;END$$;
ALTER TABLE public.ca_promo_refund_keep_receipts DROP CONSTRAINT ticket_keep_native_fault;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-ticket-keep-fault-'+mode)
   treatment={'met':'released','active':'ticket_restore','lost':'successor'}[mode]
   kept_amount={'met':2,'active':1,'lost':20}[mode];on_ticket={'met':0,'active':10,'lost':20}[mode]
   original_state={'met':"closed_at IS NOT NULL AND close_reason='met' AND remaining=0",'active':"closed_at IS NULL AND remaining=10",'lost':"closed_at IS NOT NULL AND close_reason='spent' AND remaining=0"}[mode]
   e.sql(db,f"""BEGIN;
DO $$DECLARE ack jsonb;before_count int;before_grants int;fund_before numeric;custody_before numeric;remaining_before numeric;BEGIN
SELECT promo_balance INTO fund_before FROM public.clubs WHERE id='{wallet_club}';
SELECT count(*) INTO before_grants FROM public.ca_promo_play_through_grants;
SELECT COALESCE(sum(amount),0) INTO custody_before FROM public.ca_promo_principal_custody;
SELECT COALESCE(sum(remaining),0) INTO remaining_before FROM public.ca_promo_play_through_grants;
IF fund_before<>{1050-promo} THEN RAISE EXCEPTION 'opening fund is not the original fund less the gift';END IF;
ack:=public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
IF (ack->>'value')::numeric<>20 OR ack->>'replayed'<>'false' THEN RAISE EXCEPTION 'kept ticket return answered %',ack;END IF;
IF (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>fund_before OR EXISTS(SELECT 1 FROM public.ca_promo_ticket_principal_fee_returns) OR EXISTS(SELECT 1 FROM public.chip_ledger WHERE idempotency_key LIKE 'promo_ticket_fee_return:%') THEN RAISE EXCEPTION 'a kept refund paid the promo fund';END IF;
IF NOT EXISTS(SELECT 1 FROM public.tournament_tickets WHERE id={T} AND status='issued' AND value=20 AND entry_prize=18 AND entry_bounty=0 AND entry_fee=2) THEN RAISE EXCEPTION 'the refund ticket lost value';END IF;
IF EXISTS(SELECT 1 FROM public.tournament_refund_tranches) OR (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>0 THEN RAISE EXCEPTION 'refund created personal cash';END IF;
IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id={G} AND fee_target={promo}*4 AND {original_state}) THEN RAISE EXCEPTION 'original grant is not in its expected state';END IF;
IF (SELECT count(*) FROM public.ca_promo_refund_keep_receipts)<>1 OR NOT EXISTS(SELECT 1 FROM public.ca_promo_refund_keep_receipts k WHERE k.grant_id={G} AND k.treatment='{treatment}' AND k.amount={kept_amount} AND k.fee_amount=2*{promo}/20.0 AND k.ticket_id={T} AND k.entitlement_id='{entitlement}' AND k.user_id='10000000-0000-0000-0000-000000000001' AND k.holder_club_id='{wallet_club}') THEN RAISE EXCEPTION 'keep receipt is missing or wrong';END IF;
IF (SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_principal_custody c JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id AND g.closed_at IS NULL WHERE c.kind='ticket' AND c.entity_id={T})<>{on_ticket} OR (SELECT COALESCE(sum(amount),0) FROM public.ca_promo_principal_custody WHERE kind<>'ticket')<>0 THEN RAISE EXCEPTION 'promo is not held on the ticket as expected';END IF;
IF (SELECT COALESCE(sum(amount),0) FROM public.ca_promo_principal_custody)<>(SELECT COALESCE(sum(remaining),0) FROM public.ca_promo_play_through_grants) OR (SELECT COALESCE(sum(remaining),0) FROM public.ca_promo_play_through_grants)<>{on_ticket} THEN RAISE EXCEPTION 'grant remaining and custody do not conserve';END IF;
{("IF (SELECT count(*) FROM public.ca_promo_play_through_grants)<>before_grants+1 OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants s JOIN public.ca_promo_play_through_grants o ON o.id="+G+" JOIN public.ca_promo_refund_keep_receipts k ON k.successor_grant_id=s.id WHERE s.id<>o.id AND s.amount=20 AND s.remaining=20 AND s.closed_at IS NULL AND s.club_id=o.club_id AND s.user_id=o.user_id AND s.multiplier=o.multiplier AND s.fee_target=80 AND s.expires_at=o.expires_at AND s.funded_from_type=o.funded_from_type AND s.funded_from_id=o.funded_from_id AND s.source_kind=o.source_kind AND s.source_ledger_id IS NULL AND s.source_ref LIKE 'refund_successor:'||o.id||':ticket_refund:%') THEN RAISE EXCEPTION 'successor grant is missing or differs from its original';END IF;" if mode=='lost' else "IF (SELECT count(*) FROM public.ca_promo_play_through_grants)<>before_grants THEN RAISE EXCEPTION 'a grant was written that should not exist';END IF;")}
SELECT count(*) INTO before_count FROM public.chip_ledger;
ack:=public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
IF (ack->>'value')::numeric<>20 OR ack->>'replayed'<>'true' OR (SELECT count(*) FROM public.chip_ledger)<>before_count OR (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>fund_before OR (SELECT count(*) FROM public.ca_promo_refund_keep_receipts)<>1 OR (SELECT COALESCE(sum(remaining),0) FROM public.ca_promo_play_through_grants)<>{on_ticket} THEN RAISE EXCEPTION 'kept ticket return replay changed effect';END IF;
PERFORM public.fn_ca_promo_returned_ticket_principal_fee((SELECT id FROM public.chip_ledger WHERE metadata->>'kind'='tournament_entry_ticket_return' AND metadata->>'entitlement_id'='{entitlement}'),'{entitlement}',{T});
IF (SELECT count(*) FROM public.ca_promo_refund_keep_receipts)<>1 OR (SELECT COALESCE(sum(remaining),0) FROM public.ca_promo_play_through_grants)<>{on_ticket} OR (SELECT count(*) FROM public.chip_ledger)<>before_count THEN RAISE EXCEPTION 'direct owner replay restored twice';END IF;
END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-ticket-keep-'+mode)
  if mode=='active':
   target=str(uuid.uuid4())
   e.sql(db,f"""BEGIN;SET LOCAL session_replication_role=replica;
INSERT INTO public.tournaments SELECT(jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','{target}','name','Original Net Ticket Admission','status','REGISTERING','buy_in_amount',18,'buy_in_fee',2,'prize_pool',0,'total_rake',0,'bounty_pool',0,'bounty_amount',0,'is_bounty',false,'is_pko',false,'is_mystery_bounty',false,'is_vip_only',false,'authorized_to_register',false,'current_players',0,'max_players',1000,'prize_pool_finalized',false,'start_time',now()+interval '1 hour'))).* FROM public.tournaments t WHERE t.id='{event}';
SET LOCAL session_replication_role=origin;SELECT public.fn_ca_escrow_apply('{target}','native original net ticket admission');COMMIT;""",label='typed-empty-net-ticket-target')
   e.sql(db,f"""BEGIN;
DO $$DECLARE result jsonb;ticket uuid;before_fund numeric;before_ledgers int;BEGIN
SELECT id INTO STRICT ticket FROM public.tournament_tickets WHERE source_refund_entitlement_id='{entitlement}';
IF NOT EXISTS(SELECT 1 FROM public.tournament_refund_entitlements old_e JOIN public.tournament_tickets old_t ON old_t.source_refund_entitlement_id=old_e.id WHERE old_t.id=ticket AND old_e.gross=old_t.value AND old_t.value=20) THEN RAISE EXCEPTION 'kept refund ticket is not at its full value';END IF;
IF (SELECT sum(amount) FROM public.ca_promo_principal_custody WHERE kind='ticket' AND entity_id=ticket)<>10 THEN RAISE EXCEPTION 'kept promo is not on the ticket before admission';END IF;
IF (SELECT sum(amount) FROM public.ca_promo_profit_custody WHERE kind='ticket' AND entity_id=ticket)<>10 THEN RAISE EXCEPTION 'net asset lacks exact restored original W';END IF;
SELECT promo_balance INTO before_fund FROM public.clubs WHERE id='{wallet_club}';
result:=public.fn_ca_register_for_tournament_with_ticket_for('{target}',ticket,'10000000-0000-0000-0000-000000000001');
IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'original net ticket admission refused %',result;END IF;
IF (SELECT amount FROM public.ca_promo_profit_ticket_sources WHERE ticket_id=ticket)<>20 THEN RAISE EXCEPTION 'ticket snapshot is not the full kept ticket';END IF;
IF (SELECT COALESCE(sum(amount),0) FROM public.ca_promo_principal_custody WHERE kind='ticket' AND entity_id=ticket)<>0 OR (SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_principal_custody c WHERE c.kind='event' AND c.entity_id='{target}')<>(SELECT sum(remaining) FROM public.ca_promo_play_through_grants WHERE closed_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE closed_at IS NULL AND remaining>=9) THEN RAISE EXCEPTION 'kept promo did not follow the ticket into the next event still locked';END IF;
IF (SELECT sum(amount) FROM public.ca_promo_profit_custody WHERE kind='ticket' AND entity_id=ticket)<>0 OR (SELECT original_profit FROM public.ca_promo_profit_event_charge_receipts WHERE charge_ledger_id=(result->>'ledger_id')::uuid)<>10 THEN RAISE EXCEPTION 'original net W did not move once';END IF;
SELECT count(*) INTO before_ledgers FROM public.chip_ledger;
result:=public.fn_ca_register_for_tournament_with_ticket_for('{target}',ticket,'10000000-0000-0000-0000-000000000001');
IF result->>'replayed'<>'true' OR (SELECT count(*) FROM public.chip_ledger)<>before_ledgers THEN RAISE EXCEPTION 'original ticket redemption replay duplicated money';END IF;
result:=public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
IF result->>'replayed'<>'true' OR (result->>'value')::numeric<>20 OR (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>before_fund OR (SELECT count(*) FROM public.chip_ledger)<>before_ledgers THEN RAISE EXCEPTION 'post-redemption original refund replay duplicated money';END IF;
END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-original-net-ticket-redemption')
  e.report['native'].append({'case':('actual-ticket-return-' if fund_mode else 'actual-ticket-keep-')+mode,'assertions':7 if fund_mode else 22 if mode=='active' else 15})
 e.report['status']='passed'
 for path in list((root/'tests/fixtures/promo-ticket-principal-returns').glob('*.json'))+[Path(__file__),root/'scripts/ci/test-promo-principal-returns.py',root/'scripts/ci/migration-stale-pins.mjs',root/'tests/fixtures/promo-ticket-principal-returns/current-ticket-guards.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json']:remember(path)
 e.report['source_sha256']={**manifest['source_sha256'],**tested}
 e.report['current_function_pins']=len(current['functions']);e.report['current_financial_triggers']=len(current['triggers'])
 e.report['qualification_limits']=['A refunded entry keeps its promo on the ticket (20261123071237): finished play-through, open grant and used-up grant each keep the full ticket and pay no fund, with a keep-receipt fault, replay and direct-owner replay; a grant whose 30 days are over and a refund wallet in another club keep the original fund return. Real original private returned-ticket issuer, escrow refund owner, original bank/journal/31financial guards plus actual ticket immutable/tally/deferred guards execute. Original paid noncash entry, earned completion and bust are explicit typed prior-state openings. Actual cleanup on the retained COMPLETED opening creates immutable terminal loss18; original noncash refund then safely refuses with no money or evidence changes. This does not qualify the completion producer or public cancel/unregister reachability. Full W/H earning/movement and fee-return consumers are qualified separately; this source returns only exact original P cost. No player-wallet credit or cash refund tranche.']
finally:
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
'''
exec(compile(s+body,__file__,'exec'))
