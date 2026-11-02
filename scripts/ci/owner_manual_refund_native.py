"""External credit recognition never moves money or fabricates a bank refund."""
import json
from tournament_abort_native import sql_file,SERVICE

def recognize(e,db,root,event):
 from owner_terminal_native_cases import snapshot
 e.sql(db,file=root/'supabase/migrations/20261102191255_owner_retirement_recognizes_verified_manual_refunds.sql',label='manual-credit-source')
 credit='ae000000-0000-4000-8000-000000000001'
 entitlement='26b465dd-600d-42eb-9f37-68f6052febac'
 # Historical opening credit, independent of recognition: the real owner
 # has already paid through the agent/promo writer before this function runs.
 sql_file(e,db,'manual-credit-opening',"BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,to_label,amount,category,club_id,created_at,idempotency_key,status) VALUES('"+credit+"','47965354-0e56-43ef-931c-ddaab82af765','agent_wallet','47965354-0e56-43ef-931c-ddaab82af765','player_wallet','eed278a8-3ca2-4e2d-a196-0a0cd9e74f90','club_members.chip_balance',25,'agent_send','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',clock_timestamp(),'native-owner-manual-credit','posted');UPDATE public.club_members SET chip_balance=chip_balance+25 WHERE user_id='eed278a8-3ca2-4e2d-a196-0a0cd9e74f90' AND club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';COMMIT;")
 call="public.fn_ca_record_owner_manual_refund('"+entitlement+"','"+credit+"')"
 before=snapshot(e,db,'manual-before')
 for label,change,reason in [
 ('wrong-role',"SELECT set_config('request.jwt.claim.role','authenticated',true);",'owner_manual_refund_service_required'),
 ('wrong-player',"SET LOCAL session_replication_role=replica;UPDATE public.chip_ledger SET to_entity_id='47965354-0e56-43ef-931c-ddaab82af765' WHERE id='"+credit+"';SET LOCAL session_replication_role=origin;",'owner_manual_refund_credit_evidence_changed'),
 ('cashout-is-not-refund',"SET LOCAL session_replication_role=replica;UPDATE public.chip_ledger SET category='table_cashout' WHERE id='"+credit+"';SET LOCAL session_replication_role=origin;",'owner_manual_refund_credit_evidence_changed'),
 ('too-small',"SET LOCAL session_replication_role=replica;UPDATE public.chip_ledger SET amount=1 WHERE id='"+credit+"';SET LOCAL session_replication_role=origin;",'owner_manual_refund_credit_evidence_changed')]:
  sql_file(e,db,'manual-'+label,"BEGIN;"+SERVICE+change+"DO $$DECLARE refused boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'"+reason+"' THEN RAISE;END IF;refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'missing refusal';END IF;END$$;ROLLBACK;")
  assert snapshot(e,db,'manual-'+label+'-unchanged')==before
 sql_file(e,db,'manual-agent-wallet-preview',"BEGIN;"+SERVICE+"SET LOCAL session_replication_role=replica;UPDATE public.chip_ledger SET to_type='agent_wallet' WHERE id='"+credit+"';SET LOCAL session_replication_role=origin;SELECT "+call+";ROLLBACK;")
 assert snapshot(e,db,'manual-agent-wallet-money-unchanged')==before
 sql_file(e,db,'manual-preview','BEGIN;'+SERVICE+'SELECT '+call+';ROLLBACK;')
 assert snapshot(e,db,'manual-preview-unchanged')==before
 _,out,_=sql_file(e,db,'manual-record','BEGIN;'+SERVICE+'SELECT '+call+';COMMIT;')
 receipt=next(json.loads(x) for x in out.splitlines() if x.startswith('{') and 'owner_manual_credit_evidence' in x)
 assert receipt['new_payment'] is False and receipt['amount']==5 and receipt['source_credit_amount']==25
 assert snapshot(e,db,'manual-record-money-unchanged')==before
 sql_file(e,db,'manual-replay','BEGIN;'+SERVICE+'SELECT '+call+';COMMIT;')
 assert snapshot(e,db,'manual-replay-money-unchanged')==before
 rc,_,err=e.sql(db,"SELECT public.fn_ca_owner_retirement_bank_refund('"+entitlement+"');",label='manual-bank-superseded',check=False)
 assert rc and 'owner_manual_credits_supersede_bank_refunds' in err
 for verb in ('UPDATE smarter_private.owner_retirement_manual_refunds SET receipt=receipt','DELETE FROM smarter_private.owner_retirement_manual_refunds','TRUNCATE smarter_private.owner_retirement_manual_refunds'):
  rc,_,err=e.sql(db,verb,label='manual-record-immutable',check=False)
  assert rc and 'owner_retirement_bank_refund_receipt_is_immutable' in err
 e.report.setdefault('cases',[]).extend(['manual-credit-no-money','manual-credit-role','manual-credit-wrong-recipient','manual-credit-no-cashout','manual-credit-insufficient','manual-credit-rollback','manual-credit-replay','manual-credit-bank-superseded','manual-credit-immutable'])
