"""Focused native evidence for equal-share closing, with actual monetary doors."""
import json
from tournament_abort_native import sql_file,prepare_quiesced,SERVICE
TABLES=['club_members','profiles','club_wallets','clubs','chip_ledger','wallet_transactions','wallet_credit_idempotency','tournament_payouts','tournament_obligations','tournament_bounty_obligations','tournament_escrow','tournaments','tournament_players','table_seats','tournament_rake_settlements','tournament_cancellation_receipts','accounting_tournament_fee_recognitions','accounting_tournament_recognized_sources','agent_commissions','poker_diamond_custody','poker_diamond_tournament_ledger','diamond_transactions']
def snapshot(e,db,label):
 sql='SELECT jsonb_build_object('+','.join("'"+t+"',(SELECT coalesce(jsonb_agg(j ORDER BY j::text),'[]') FROM (SELECT to_jsonb(x) j FROM public."+t+" x) z)" for t in TABLES)+",'abort_targets',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY tournament_id),'[]') FROM smarter_private.tournament_abort_targets x));"
 _,out,_=e.sql(db,sql,label=label);return json.loads(out.strip())
def exercise(e,db,root,event,op,money_hash,label,expected,fee):
 call="public.fn_ca_settle_tournament_abort_equal_share('"+op+"','"+event+"','"+money_hash+"')"
 before=snapshot(e,db,label+'-before')
 preview_call=call.replace('fn_ca_settle_tournament_abort_equal_share','fn_ca_preview_tournament_abort_equal_share')
 def refused(name,body,reason):
  sql_file(e,db,label+'-'+name,"BEGIN;"+SERVICE+"DO $$DECLARE failed boolean:=false;BEGIN BEGIN "+body+" EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '"+reason+"%' THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'expected refusal absent';END IF;END$$;ROLLBACK;")
  assert snapshot(e,db,label+'-'+name+'-unchanged')==before
 if label=='chip':
  migration=(root/'supabase/migrations/20261101004247_started_tournament_abort_supports_equal_share_settlement.sql').read_text()
  alternative=migration[migration.index('CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort_equal_share'):migration.index('END $function$')+len('END $function$')]+';'
  close=next(line for line in alternative.splitlines() if "UPDATE public.tournaments SET status='CANCELLED',ended_at=settled,updated_at" in line)
  alternative=alternative.replace(close+'\n','')
  start=alternative.index(' -- A transaction-bound administrative retirement')
  end=alternative.index(' -- Keep original eliminated_at',start)
  alternative=alternative[:start]+close+'\n'+alternative[end:]
  sql_file(e,db,'actual-alternative-terminal-order-refused',"BEGIN;"+alternative+SERVICE+"DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'terminal tournament %immutable tournament_players evidence' THEN RAISE;END IF;RAISE NOTICE '%',SQLERRM;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'early terminal ordering unexpectedly admitted retirement';END IF;END$$;ROLLBACK;")
  assert snapshot(e,db,'actual-alternative-order-unchanged')==before
  refused('admission-cannot-commit-alone',"UPDATE smarter_private.tournament_abort_targets SET receipt=jsonb_build_object('mode','equal_share_retirement_admission','transaction_id',txid_current()) WHERE tournament_id='"+event+"';SET CONSTRAINTS ALL IMMEDIATE;",'equal_share_retirement_requires_terminal_receipt')
  sql_file(e,db,'live-zero-stack-guard-retained',"BEGIN;"+SERVICE+"UPDATE public.tournaments SET status='COMPLETING' WHERE id='"+event+"';UPDATE public.tournament_players SET status='eliminated',chips=0,current_bounty=0 WHERE tournament_id='"+event+"';DO $$BEGIN IF (SELECT count(*) FROM tournament_players WHERE tournament_id='"+event+"' AND status='playing')<>2 THEN RAISE EXCEPTION 'live zero-stack guard weakened';END IF;END$$;ROLLBACK;")
  assert snapshot(e,db,'live-zero-stack-guard-unchanged')==before
  e.report.setdefault('cases',[]).extend(['terminal-marker-blocks-early-cancel','unreceipted-retirement-admission-refused','live-zero-stack-bust-refusal-preserved'])
 refused('wrong-review',"PERFORM public.fn_ca_settle_tournament_abort_equal_share('"+op+"','"+event+"','wrong');",'operator_abort_review_hash_mismatch')
 refused('wrong-role',"PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM "+call+';','operator_abort_service_required')
 if label=='chip':
  refused('preview-wrong-review',"PERFORM "+preview_call.replace(money_hash,'wrong')+';','operator_abort_review_hash_mismatch')
  refused('preview-wrong-role',"PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM "+preview_call+';','operator_abort_service_required')
  e.report.setdefault('cases',[]).extend(['preview-role-refusal','preview-review-refusal'])
 _,preview_out,_=sql_file(e,db,label+'-explicit-preview','BEGIN;'+SERVICE+'SELECT '+preview_call+';COMMIT;')
 preview=next(json.loads(line) for line in preview_out.splitlines() if line.startswith('{') and 'preview_only' in line)
 assert preview['preview_only'] is True and preview['rolled_back'] is True
 assert preview['operation_id']==op and preview['tournament_id']==event and preview['money_hash']==money_hash
 assert snapshot(e,db,label+'-preview-independent-readback')==before
 e.report.setdefault('cases',[]).append(label+':preview-commits-no-effects')
 sql_file(e,db,label+'-rollback','BEGIN;'+SERVICE+'SELECT '+call+';ROLLBACK;')
 assert snapshot(e,db,label+'-rolled-back')==before
 sql_file(e,db,label+'-fault-after-credit',"BEGIN;"+SERVICE+"CREATE FUNCTION pg_temp.refuse_equal_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native_equal_receipt_failure';END$$;CREATE TRIGGER native_equal_failure BEFORE INSERT ON public.tournament_cancellation_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_equal_receipt();DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'native_equal_receipt_failure' THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'fault did not execute';END IF;END$$;ROLLBACK;")
 assert snapshot(e,db,label+'-fault-rolled-back')==before
 from satellite_qualifier_fixture import module
 concurrent=module(root/'scripts/ci/test-tournament-cancellation-lane.py',label+'_concurrent');left=concurrent.Session(e,db);right=concurrent.Session(e,db)
 try:
  left.query("BEGIN;SELECT smarter_private.cancellation_lane('"+event+"');")
  right.query('BEGIN;'+SERVICE+"DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN lock_not_available THEN failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'concurrent lane admitted';END IF;END$$;")
 finally:left.close();right.close()
 assert snapshot(e,db,label+'-concurrent-unchanged')==before
 _,out,_=sql_file(e,db,label+'-commit','BEGIN;'+SERVICE+'SELECT '+call+';COMMIT;')
 receipt=next(json.loads(line) for line in out.splitlines() if line.startswith('{') and 'total_distributed' in line)
 assert receipt['receipt_version']==4 and receipt['mode']=='started_operator_equal_share'
 assert preview['receipt']['financial']==receipt['financial'] and preview['allocation_hash']==receipt['allocation_hash']
 e.report.setdefault('cases',[]).append(label+':preview-matches-normal-settlement')
 assert receipt['financial']['total_distributed']==sum(expected)
 assert [x['amount'] for x in receipt['financial']['shares']]==expected
 assert receipt['total_refunded']==0 and receipt['fees_reversed']==0
 assert receipt['fee_receipt']['amount']==fee and receipt['fee_receipt']['attributed'] is True
 after=snapshot(e,db,label+'-committed')
 for share in receipt['financial']['shares']:
  user=share['user_id']
  if receipt['financial']['asset']=='diamonds':
   old=next(x['diamonds'] for x in before['profiles'] if x['id']==user);new=next(x['diamonds'] for x in after['profiles'] if x['id']==user)
  else:
   club=next(x['club_id'] for x in before['tournament_players'] if x['id']==share['registration_id'])
   old=next(x['chip_balance'] for x in before['club_members'] if x['club_id']==club and x['user_id']==user);new=next(x['chip_balance'] for x in after['club_members'] if x['club_id']==club and x['user_id']==user)
  from decimal import Decimal
  assert Decimal(str(new))-Decimal(str(old))==Decimal(str(share['amount']))

 sql_file(e,db,label+'-replay','BEGIN;'+SERVICE+'SELECT '+call+';SELECT public.fn_ca_tournament_cancellation_receipt(\''+event+'\');COMMIT;')
 assert snapshot(e,db,label+'-replayed')==after
 if label=='chip':
  for field in ['amount','prize','bounty']:
   for malformed in ['null',json.dumps(str(receipt['financial']['shares'][0][field]))]:
    expression="jsonb_set(receipt,'{financial,shares,0,"+field+"}','"+malformed.replace("'","''")+"'::jsonb)"
    sql_file(e,db,'malformed-share-'+field+'-'+('null' if malformed=='null' else 'string'),"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.tournament_cancellation_receipts SET receipt=("+expression+")||jsonb_build_object('allocation_hash',md5((("+expression+")->'financial'->'shares')::text)) WHERE tournament_id='"+event+"';UPDATE smarter_private.tournament_abort_targets SET receipt=(SELECT receipt FROM public.tournament_cancellation_receipts WHERE tournament_id='"+event+"') WHERE tournament_id='"+event+"';SET LOCAL session_replication_role=origin;DO $$DECLARE failed boolean:=false;BEGIN BEGIN PERFORM public.fn_ca_tournament_cancellation_receipt('"+event+"');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'equal_share_receipt_share_scalar_invalid' THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'malformed share receipt accepted';END IF;END$$;ROLLBACK;")
    assert snapshot(e,db,'malformed-share-rolled-back')==after
    e.report.setdefault('cases',[]).append('malformed-share-'+field+'-'+('null' if malformed=='null' else 'string'))
 original=[x for x in before['tournament_payouts'] if x['tournament_id']==event]
 assert all(any({k:v for k,v in x.items() if k!='terminal_closed_at'}=={k:v for k,v in y.items() if k!='terminal_closed_at'} for y in after['tournament_payouts']) for x in original)
 for x in before['tournament_obligations']:assert x in after['tournament_obligations']
 closed=next(x for x in after['tournaments'] if x['id']==event)
 assert closed['status']=='CANCELLED' and closed['current_players']==0
 assert all(x['status']=='eliminated' and x['chips']==0 for x in after['tournament_players'] if x['tournament_id']==event)
 escrow=next(x for x in after['tournament_escrow'] if x['tournament_id']==event)
 assert escrow['prize_balance']==escrow['bounty_balance']==escrow['fee_balance']==0 and escrow['closed_at']
 e.report.setdefault('cases',[]).extend(label+':'+case for case in ['independent-wallet-deltas','role-refusal','review-hash-refusal','full-rollback','late-fault-rollback','two-backend-conflict','equal-combined-distribution','normal-fees','canonical-v4','exact-replay','prior-awards','zero-terminal-custody'])
 return receipt

def diamond_cases(e,db,root,diamond):
 diamond.seed(e,db)
 for index,free in [(1,False),(2,True)]:
  tail=f'{index:012d}';event='ea300000-0000-4000-8000-'+tail;op='ea400000-0000-4000-8000-'+tail;table='ea500000-0000-4000-8000-'+tail
  sql=diamond.event_sql(event,'Native equal Diamond',free)
  for uid in [diamond.U1,diamond.U2]:
   if free:sql+="SELECT public.fn_poker_diamond_tournament_free_entry('"+uid+"','"+event+"',gen_random_uuid());"
   else:sql+="SELECT public.fn_poker_diamond_tournament_charge('"+uid+"','"+event+"','entry',20,12,6,2,gen_random_uuid(),'equal-"+uid+"');"
  if not free:sql+="SELECT public.fn_credit_and_log('"+diamond.U1+"',1,'tourney:"+event+":native-earned-bounty','bounty','Native earlier earned bounty','"+event+"');"
  sql_file(e,db,'diamond-equal-funding-'+str(index),sql+'COMMIT;')
  money_hash=prepare_quiesced(e,db,event,op,table)
  receipt=exercise(e,db,root,event,op,money_hash,'diamond-'+str(index),[0,0] if free else [18,17],0 if free else 4)
  assert receipt['financial']['unit_scale']==1

def capacity_case(e,db,root):
 """Largest observed remaining roster, under the serving RPC's 8s cap."""
 import time
 event='eb300000-0000-4000-8000-000000000001';op='eb400000-0000-4000-8000-000000000001';table='eb500000-0000-4000-8000-000000000001';club='d2000000-0000-4000-8000-000000000002'
 sql="BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO public.tournaments(id,name,buy_in_amount,buy_in_fee,starting_chips,start_time,status,current_players,max_players,current_level,club_id,prize_pool,total_rake,bounty_pool,entry_contract_locked,is_rebuy,is_reentry,rebuy_levels,late_reg_levels,late_reg_mins) VALUES('"+event+"','Native largest remaining roster',90,10,1000,clock_timestamp()+interval '1 day','REGISTERING',0,1000,1,'"+club+"',0,0,0,false,false,false,0,0,0);"
 ids=[]
 for i in range(315):
  uid='eb100000-0000-4000-8000-'+f'{i+1:012d}';sid='eb200000-0000-4000-8000-'+f'{i+1:012d}';ids.append((uid,sid))
  sql+="INSERT INTO auth.users(id) VALUES('"+uid+"');INSERT INTO public.users(id,username) VALUES('"+uid+"','capacity_"+str(i)+"');INSERT INTO public.profiles(id,username,display_name) VALUES('"+uid+"','capacity_"+str(i)+"','Native capacity');INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance,joined_at) VALUES('"+club+"','"+uid+"','player','active',1000,clock_timestamp()-interval '1 day');INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES('"+sid+"','"+uid+"',now(),now());"
 # Same historical agreement baseline as the maintained fee-lifecycle fixture,
 # captured before any actual charge; no synthetic fee or recognition receipt.
 sql+="UPDATE public.club_members SET agent_id='d1000000-0000-4000-8000-000000000001' WHERE club_id='"+club+"' AND user_id::text LIKE 'eb100000-%';INSERT INTO public.accounting_agreement_history(entity_type,entity_key,club_id,subject_user_id,event_type,observed_at,after_terms) SELECT 'club_members',m.club_id::text||':'||m.user_id::text,m.club_id,m.user_id,'baseline',transaction_timestamp(),to_jsonb(m) FROM public.club_members m WHERE m.club_id='"+club+"' AND m.user_id::text LIKE 'eb100000-%';"
 sql_file(e,db,'capacity-fixture-identities',sql+'COMMIT;')
 # Real original request-bound registration captures all315 funding and fee terms.
 for offset in range(0,315,25):
  sql='BEGIN;SET LOCAL statement_timeout=\'60s\';'
  for uid,sid in ids[offset:offset+25]:
   claims=json.dumps({'sub':uid,'role':'authenticated','session_id':sid})
   sql+="SELECT set_config('request.jwt.claims','"+claims+"',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','"+uid+"',true);SET LOCAL ROLE authenticated;SELECT public.fn_register_for_tournament_request('"+event+"',gen_random_uuid());RESET ROLE;"
  sql_file(e,db,'capacity-real-entry-'+str(offset),sql+'COMMIT;')
 sql_file(e,db,'capacity-prior-earned-award',"BEGIN;"+SERVICE+"SELECT public.fn_credit_and_log('"+ids[0][0]+"',0.01,'tourney:"+event+":native-earlier-award','prize','Native preserved earlier award','"+event+"','PLAYER',NULL,NULL,NULL,'reconcile');SET LOCAL session_replication_role=replica;UPDATE tournament_players SET status='playing' WHERE tournament_id='"+event+"';COMMIT;")
 money_hash=prepare_quiesced(e,db,event,op,table)
 before=snapshot(e,db,'capacity-before');assert len([x for x in before['tournament_players'] if x['tournament_id']==event])==315
 def timed_call(fn,label):
  start=time.monotonic();_,out,_=sql_file(e,db,label,"BEGIN;SET LOCAL statement_timeout='8s';"+SERVICE+"SELECT public."+fn+"('"+op+"','"+event+"','"+money_hash+"');COMMIT;")
  elapsed=time.monotonic()-start
  result=next(json.loads(line) for line in out.splitlines() if line.startswith('{') and ('total_distributed' in line))
  e.report.setdefault('capacity_315',{})[label]={'wall_seconds':elapsed,'statement_timeout_ms':8000}
  return result
 preview=timed_call('fn_ca_preview_tournament_abort_equal_share','capacity-preview')
 assert preview['preview_only'] is True and preview['rolled_back'] is True and snapshot(e,db,'capacity-preview-unchanged')==before
 receipt=timed_call('fn_ca_settle_tournament_abort_equal_share','capacity-settlement')
 assert receipt['financial']==preview['receipt']['financial'] and receipt['allocation_hash']==preview['allocation_hash']
 shares=receipt['financial']['shares'];assert len(shares)==315 and [x['amount'] for x in shares]==[90]*314+[89.99]
 assert receipt['financial']['total_distributed']==28349.99 and receipt['fee_receipt']['amount']==3150
 after=snapshot(e,db,'capacity-after')
 from decimal import Decimal
 for share in shares:
  old=next(x['chip_balance'] for x in before['club_members'] if x['club_id']==club and x['user_id']==share['user_id']);new=next(x['chip_balance'] for x in after['club_members'] if x['club_id']==club and x['user_id']==share['user_id'])
  assert Decimal(str(new))-Decimal(str(old))==Decimal(str(share['amount']))
 escrow=next(x for x in after['tournament_escrow'] if x['tournament_id']==event);assert escrow['prize_balance']==escrow['bounty_balance']==escrow['fee_balance']==0
 assert next(x for x in after['tournaments'] if x['id']==event)['status']=='CANCELLED'
 e.report.setdefault('cases',[]).extend(['capacity315-preview-8s','capacity315-settlement-8s','capacity315-wallet-conservation'])
