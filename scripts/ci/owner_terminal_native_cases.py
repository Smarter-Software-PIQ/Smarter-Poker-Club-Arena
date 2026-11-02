import json
from tournament_abort_native import sql_file,prepare_quiesced,SERVICE
from equal_share_native_cases import snapshot as base_snapshot

def snapshot(e,db,label):
 result=base_snapshot(e,db,label)
 _,out,_=e.sql(db,"SELECT jsonb_build_object('bank',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.union_wallets x),'bank_transactions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.union_wallet_transactions x),'bank_refunds',(SELECT jsonb_agg(to_jsonb(x) ORDER BY entitlement_id) FROM smarter_private.owner_retirement_bank_refunds x),'transfers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id) FROM smarter_private.owner_retirement_pool_transfers x),'movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM public.poker_diamond_movements x));",label=label+'-owner')
 result.update(json.loads(out.strip()));return result

def exercise(e,db,event,op,money_hash,amount,fee,label):
 call="public.fn_ca_owner_retire_tournament('"+op+"','"+event+"','"+money_hash+"')"
 before=snapshot(e,db,label+'-before')
 def refuse(name,body,reason):
  sql_file(e,db,label+'-'+name,"BEGIN;"+SERVICE+"DO $$DECLARE failed boolean:=false;BEGIN BEGIN "+body+" EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '"+reason+"%' THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'expected refusal absent';END IF;END$$;ROLLBACK;")
  assert snapshot(e,db,label+'-'+name+'-unchanged')==before
 refuse('stale-review','PERFORM '+call.replace(money_hash,'wrong')+';','operator_abort_review_hash_mismatch')
 refuse('wrong-role',"PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM "+call+';','operator_abort_service_required')
 refuse('orphan-transfer',"PERFORM smarter_private.owner_retirement_transfer_pools('"+op+"','"+event+"');SET CONSTRAINTS ALL IMMEDIATE;",'owner_retirement_terminal_evidence_changed')
 refuse('orphan-admission',"UPDATE smarter_private.tournament_abort_targets SET receipt=jsonb_build_object('mode','owner_retirement_admission','transaction_id',txid_current()) WHERE tournament_id='"+event+"';SET CONSTRAINTS ALL IMMEDIATE;",'owner_retirement_terminal_evidence_changed')
 from satellite_qualifier_fixture import module
 from pathlib import Path
 root=Path(__file__).resolve().parents[2]
 concurrent=module(root/'scripts/ci/test-tournament-cancellation-lane.py',label+'_owner_concurrent');left=concurrent.Session(e,db);right=concurrent.Session(e,db)
 try:
  left.query("BEGIN;SELECT smarter_private.cancellation_lane('"+event+"');")
  right.query('BEGIN;'+SERVICE+"DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN lock_not_available THEN failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'concurrent lane admitted';END IF;END$$;")
 finally:left.close();right.close()
 assert snapshot(e,db,label+'-concurrent-unchanged')==before
 sql_file(e,db,label+'-preview','BEGIN;'+SERVICE+'SELECT '+call+';SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;')
 assert snapshot(e,db,label+'-preview-unchanged')==before
 sql_file(e,db,label+'-late-fault',"BEGIN;"+SERVICE+"CREATE FUNCTION pg_temp.owner_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native_owner_receipt_fault';END$$;CREATE TRIGGER native_owner_receipt_fault BEFORE INSERT ON public.tournament_cancellation_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.owner_receipt_fault();DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'native_owner_receipt_fault' THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'fault absent';END IF;END$$;ROLLBACK;")
 assert snapshot(e,db,label+'-late-fault-unchanged')==before
 _,out,_=sql_file(e,db,label+'-commit','BEGIN;'+SERVICE+'SELECT '+call+';SET CONSTRAINTS ALL IMMEDIATE;COMMIT;')
 receipt=next(json.loads(x) for x in out.splitlines() if x.startswith('{') and 'receipt_version' in x)
 assert receipt['receipt_version']==6 and receipt['financial']['amount']==amount and receipt['fee_receipt']['amount']==fee
 after=snapshot(e,db,label+'-after')
 _,out,_=sql_file(e,db,label+'-replay','BEGIN;'+SERVICE+'SELECT '+call+';COMMIT;')
 assert next(json.loads(x) for x in out.splitlines() if x.startswith('{') and 'receipt_version' in x)==receipt
 assert snapshot(e,db,label+'-replay-unchanged')==after
 for verb in ('UPDATE smarter_private.owner_retirement_pool_transfers SET receipt=receipt','DELETE FROM smarter_private.owner_retirement_pool_transfers','TRUNCATE smarter_private.owner_retirement_pool_transfers'):
  rc,_,err=e.sql(db,verb,label=label+'-immutable',check=False)
  assert rc and 'owner_retirement_pool_transfer_is_immutable' in err
 assert snapshot(e,db,label+'-immutable-unchanged')==after
 old=[x for x in before['tournament_payouts'] if x['tournament_id']==event]
 assert all(any({k:v for k,v in x.items() if k!='terminal_closed_at'}=={k:v for k,v in y.items() if k!='terminal_closed_at'} for y in after['tournament_payouts']) for x in old)
 e.report.setdefault('cases',[]).extend(label+':'+x for x in ['concurrent-lane-refused','orphan-admission-refused','stale-review','wrong-role','orphan-transfer-refused','rollback','late-fault-atomic','commit-conservation','canonical-six','idempotent-replay','immutable','prior-awards'])
 return receipt

def chips(e,db,root,manifest,human=False):
 target=next(x for x in manifest['targets'] if x['asset']=='chips' and x['tournament_id'] not in ['2781bcd7-cc8a-4713-ab3e-0d0a81fdf110','6379b29e-1307-4e8b-91e7-e9a0975cd64d','d5decc98-cd0f-417f-aa28-6df009a74c76','7986217a-0a67-4585-bd43-254356a9cb54'])
 if human:target=next(x for x in manifest['targets'] if x['tournament_id']=='2781bcd7-cc8a-4713-ab3e-0d0a81fdf110')
 event=target['tournament_id'];op='ac000000-0000-4000-8000-000000000002';table='ad000000-0000-4000-8000-000000000002'
 catalog=json.loads((root/'scripts/ci/fixtures/tournament-abort/owner-bank-refund-catalog.json').read_text())
 for f in catalog['functions']:sql_file(e,db,'current-bank-'+f['signature'].split('(')[0],f['definition']+';')
 for row in catalog['coverage']:
  values=','.join("'"+str(row[k]).replace("'","''")+"'" for k in ('store','treatment','counted_by','notes'))
  sql_file(e,db,'bank-store-'+row['store'],'INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES('+values+') ON CONFLICT(store) DO NOTHING;')
 seed=(root/'scripts/ci/probes/satellite-cancel-current-native.sql').read_text().split('-- Fund the source through')[0].replace('ON COMMIT DROP;','ON COMMIT PRESERVE ROWS;')
 earning=(root/'tests/fixtures/tournament-fee-lifecycle/full-lifecycle-earning.sql').read_text()
 agreements=earning[earning.index('INSERT INTO public.club_wallets(club_id)'):earning.index('SET LOCAL session_replication_role=origin;',earning.index('INSERT INTO public.club_wallets(club_id)'))]
 union="""INSERT INTO public.unions(id,name,owner_id,slug) VALUES('fade0000-0000-0000-0000-000000000001','Local Main Bank','2d1cd6c3-5700-4af9-a271-d4863fdab20d','native-main-bank');
 INSERT INTO public.union_wallets(union_id,chip_balance) VALUES('fade0000-0000-0000-0000-000000000001',1000);
 UPDATE public.clubs SET union_id='fade0000-0000-0000-0000-000000000001' WHERE id IN ('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002');
 INSERT INTO public.union_clubs(union_id,club_id) VALUES('fade0000-0000-0000-0000-000000000001','d2000000-0000-4000-8000-000000000001'),('fade0000-0000-0000-0000-000000000001','d2000000-0000-4000-8000-000000000002');
 INSERT INTO public.accounting_agreement_history(entity_type,entity_key,club_id,event_type,observed_at,after_terms) SELECT 'union_clubs',u.union_id::text||':'||u.club_id::text,u.club_id,'baseline',transaction_timestamp(),to_jsonb(u) FROM public.union_clubs u WHERE u.union_id='fade0000-0000-0000-0000-000000000001';
 UPDATE public.tournaments SET union_id='fade0000-0000-0000-0000-000000000001' WHERE club_id='d2000000-0000-4000-8000-000000000002';
 UPDATE public.profiles SET is_horse=true WHERE id IN ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002');
 """
 seed=seed.replace('SET LOCAL session_replication_role=origin;',union+agreements+'SET LOCAL session_replication_role=origin;',1).replace('d3000000-0000-4000-8000-000000000002',event).replace('d2000000-0000-4000-8000-000000000002','a41434bb-8d0c-400a-8f0d-e8b3d65afed4')
 if human:
  replacements={'d1000000-0000-4000-8000-000000000001':'eed278a8-3ca2-4e2d-a196-0a0cd9e74f90',"'Cancellation Entrant Target',90,10,1000":"'Cancellation Entrant Target',4.5,0.5,1000",'FROM 100::numeric':'FROM 5::numeric','FROM 10::numeric':'FROM 0.5::numeric','IS DISTINCT FROM 100::numeric':'IS DISTINCT FROM 195::numeric','AND e.gross=100 AND e.refund_prize=90':'AND e.gross=5 AND e.refund_prize=4.5','AND e.refund_bounty=0 AND e.refund_fee=10':'AND e.refund_bounty=0 AND e.refund_fee=0.5','AND r.rake_amount=10':'AND r.rake_amount=0.5'}
  for a,b in replacements.items():seed=seed.replace(a,b)
  seed=seed.replace('IS DISTINCT FROM 5::numeric\n     OR (SELECT count(*)','IS DISTINCT FROM 195::numeric\n     OR (SELECT count(*)')
 sql_file(e,db,'real-owner-chip-entry','BEGIN;'+seed+'COMMIT;')
 sql_file(e,db,'owner-chip-start',"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.tournaments SET started_at=(SELECT original_started_at FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id='"+event+"') WHERE id='"+event+"';UPDATE public.tournament_players SET status='playing' WHERE tournament_id='"+event+"';COMMIT;")
 if human:
  sql_file(e,db,'original-human-charge-identities',"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.profiles SET is_horse=false WHERE id='eed278a8-3ca2-4e2d-a196-0a0cd9e74f90';UPDATE public.tournaments SET status='RUNNING' WHERE id='"+event+"';UPDATE public.chip_ledger SET id='322489e1-e6a3-4f6e-a8b9-50f66d7866a5' WHERE id=(SELECT source_ledger_id FROM public.tournament_refund_entitlements WHERE tournament_id='"+event+"');UPDATE public.tournament_refund_entitlements SET id='26b465dd-600d-42eb-9f37-68f6052febac',source_ledger_id='322489e1-e6a3-4f6e-a8b9-50f66d7866a5' WHERE tournament_id='"+event+"';COMMIT;")
  sql_file(e,db,'original-human-bank-refund','BEGIN;'+SERVICE+"SELECT public.fn_ca_owner_retirement_bank_refund('26b465dd-600d-42eb-9f37-68f6052febac');COMMIT;")
 money_hash=prepare_quiesced(e,db,event,op,table)
 if human:
  before=snapshot(e,db,'human-required-refund-before')
  sql_file(e,db,'human-required-refund-refused',"BEGIN;"+SERVICE+"SET LOCAL session_replication_role=replica;DELETE FROM smarter_private.owner_retirement_bank_refunds WHERE tournament_id='"+event+"';SET LOCAL session_replication_role=origin;DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM public.fn_ca_owner_retire_tournament('"+op+"','"+event+"','"+money_hash+"');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'owner_retirement_original_refund_missing' THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'missing refund admitted';END IF;END$$;ROLLBACK;")
  assert snapshot(e,db,'human-required-refund-after')==before
  e.report.setdefault('cases',[]).append('human-original-bank-refund-required')
 receipt=exercise(e,db,event,op,money_hash,4.5 if human else 90,0.5 if human else 10,'chips-human-refunded' if human else 'chips')
 assert receipt['fee_receipt']['destination']=='union:fade0000-0000-0000-0000-000000000001'
