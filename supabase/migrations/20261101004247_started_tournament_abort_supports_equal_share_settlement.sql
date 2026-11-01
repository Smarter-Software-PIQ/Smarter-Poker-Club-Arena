-- @install-window: daily-maintenance
-- @live-proof: (SELECT bool_and(coalesce(md5(pg_get_functiondef(to_regprocedure(signature)))=expected,false)) FROM (VALUES ('fn_ca_preview_tournament_abort_equal_share(uuid,uuid,text)','64371a889e6723b0f80c70310831b0bb'),('fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)','b88bcee008774d5e9eab175bc87d3b04'),('fn_ca_tournament_cancellation_receipt(uuid,uuid)','b6dad088592fcbbf313ddab376478532'),('fn_credit_and_log(uuid,numeric,text,text,text,uuid,text,uuid,uuid,integer,text)','f7bcbff31505ec690f310df7dc0a19ff'),('fn_refuse_zero_chip_field_elimination()','8150bc16b61800e79d5355f1b3507a9a'),('smarter_private.equal_share_retirement_must_close()','d6711284f022f2ae11664d2ed3c50045'),('smarter_private.tournament_equal_share_receipt(uuid,uuid)','574b3f32a9dbc54f989618901bf868f6')) x(signature,expected)) AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='smarter_private.tournament_abort_targets'::regclass AND tgname='equal_share_retirement_must_close' AND tgdeferrable AND tginitdeferred AND tgenabled='O') AND NOT has_function_privilege('authenticated','public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_preview_tournament_abort_equal_share(uuid,uuid,text)','EXECUTE')
-- Explicit started-event equal-share disposition, separate from original-charge
-- refunds. Combined unawarded prize and bounty banks go equally to remaining
-- players, preserving earned awards and original hands. Fees keep their owner.
-- Version reserved by scripts/new-migration.mjs.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$BEGIN
 IF md5(pg_get_functiondef('public.fn_credit_and_log(uuid,numeric,text,text,text,uuid,text,uuid,uuid,integer,text)'::regprocedure)) IS DISTINCT FROM '3ede19642ab1ca18b7e185caae03d192'
 OR md5(pg_get_functiondef('public.fn_ca_tournament_cancellation_receipt(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '796fe848452599c36751f22996ee761b'
 OR md5(pg_get_functiondef('public.fn_refuse_zero_chip_field_elimination()'::regprocedure)) IS DISTINCT FROM '97d03afb414b95e0f3bd959df6075c2c'
 THEN RAISE EXCEPTION 'equal_share_exact_authority_preimage_required' USING ERRCODE='55000';END IF;
END $migration$;
ALTER TABLE public.tournament_cancellation_receipts DROP CONSTRAINT tournament_cancellation_receipts_receipt_version_check;
ALTER TABLE public.tournament_cancellation_receipts ADD CONSTRAINT tournament_cancellation_receipts_receipt_version_check CHECK (
 receipt_version=2 OR (receipt_version=3 AND receipt->>'mode' IS NOT DISTINCT FROM 'started_operator_abort' AND receipt->>'operation_id' IS NOT NULL)
 OR (receipt_version=4 AND receipt->>'mode' IS NOT DISTINCT FROM 'started_operator_equal_share' AND receipt->>'operation_id' IS NOT NULL));
ALTER TABLE public.tournament_cancellation_receipts DROP CONSTRAINT tournament_cancellation_receipts_check12;
ALTER TABLE public.tournament_cancellation_receipts ADD CONSTRAINT tournament_cancellation_receipts_check12 CHECK (
 total_rake_before::text NOT IN('NaN','Infinity','-Infinity') AND total_rake_after::text NOT IN('NaN','Infinity','-Infinity') AND total_rake_before>=0
 AND ((receipt_version IN(2,3) AND total_rake_after=0 AND total_rake_before=fees_reversed)
 OR (receipt_version=4 AND total_rake_after=total_rake_before AND fees_reversed=0 AND total_refunded=0 AND total_ticket_returned=0
 AND refund_line_count=0 AND ticket_return_count=0 AND cardinality(fee_reversal_ids)=0)));
DO $migration$DECLARE definition text;BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='public.tournament_payouts'::regclass AND conname='tournament_payouts_source_check';
 IF position('finish_position_correction' IN definition)=0 THEN RAISE EXCEPTION 'equal_share_payout_constraint_preimage';END IF;
 EXECUTE 'ALTER TABLE public.tournament_payouts DROP CONSTRAINT tournament_payouts_source_check';
 EXECUTE 'ALTER TABLE public.tournament_payouts ADD CONSTRAINT tournament_payouts_source_check '||replace(definition,'''finish_position_correction''::text','''finish_position_correction''::text, ''operator_abort_equal_share''::text');
END $migration$;
DO $migration$DECLARE source text;needle text:='''satellite_seat'',''satellite_ticket'',''finish_position_correction''';BEGIN
 source:=pg_get_functiondef('public.fn_credit_and_log(uuid,numeric,text,text,text,uuid,text,uuid,uuid,integer,text)'::regprocedure);
 IF position(needle IN source)=0 THEN RAISE EXCEPTION 'equal_share_credit_preimage';END IF;
 EXECUTE replace(source,needle,needle||',''operator_abort_equal_share''');
END $migration$;
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES('fn_ca_settle_tournament_abort_equal_share','approved','Explicit drained equal-share settlement; canonical credits, immutable v4 receipt, no refunds or clawbacks') ON CONFLICT(proname) DO NOTHING;
DO $migration$BEGIN IF NOT EXISTS(SELECT 1 FROM public.ca_money_rpc_registry WHERE proname='fn_ca_settle_tournament_abort_equal_share' AND status='approved') THEN RAISE EXCEPTION 'equal_share_money_authority_not_approved' USING ERRCODE='42501';END IF;END $migration$;
CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort_equal_share(p_operation_id uuid, p_tournament_id uuid, p_expected_money_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE a smarter_private.tournament_abort_targets;t public.tournaments; financial jsonb; v_receipt jsonb; pre_roster jsonb; pre_seats jsonb; before_history jsonb; after_history jsonb;
 player_ids uuid[];refunded_ids uuid[];zero_ids uuid[];table_ids uuid[];seat_ids uuid[];released_ids uuid[];fee_ids uuid[]:='{}';
 fee record;fee_id uuid; rake_before numeric;rake_after numeric;fees_reversed numeric:=0; settled timestamptz:=clock_timestamp();
 recipient record;bank record;prize_units numeric;bounty_units numeric;total_units numeric;unit_scale numeric;n integer;ordinal integer:=0;share_units numeric;prize_part numeric;bounty_part numeric;key text;shares jsonb:='[]';prior_payouts jsonb;fee_receipt jsonb;
 actor constant uuid:='2d1cd6c3-5700-4af9-a271-d4863fdab20d'; v_close_note constant text:='Explicit operator equal-share close after generation-bound physical and manager drain';
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_not_recovered(p_operation_id,p_tournament_id);
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'equal_share_platform_frozen' USING ERRCODE='55000';END IF;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_abort_target_not_owned';END IF;
 IF a.state='settled' THEN
  IF a.receipt->>'mode' IS DISTINCT FROM 'started_operator_equal_share' THEN RAISE EXCEPTION 'operator_abort_disposition_already_committed';END IF;
  RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id);END IF;
 PERFORM smarter_private.assert_tournament_abort_quiesced(p_operation_id,p_tournament_id);
 IF p_expected_money_hash IS NULL OR p_expected_money_hash IS DISTINCT FROM a.quiescence->>'money_hash' THEN RAISE EXCEPTION 'operator_abort_review_hash_mismatch' USING ERRCODE='55000';END IF;
 IF t.started_at IS NULL OR upper(t.status) NOT IN('RUNNING','BREAK','LATE_REG') THEN RAISE EXCEPTION 'operator_abort_parent_not_running';END IF;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tables WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id ORDER BY s.id FOR UPDATE OF s;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'),coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO player_ids,pre_roster FROM public.tournament_players p WHERE tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO table_ids FROM public.tables WHERE tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO seat_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'table_id',s.table_id,'user_id',s.user_id,'seat_number',s.seat_number,'stack',s.stack,'status',s.status,'left_at',s.left_at,'occupancy_id',to_jsonb(s)->'occupancy_id') ORDER BY s.id),'[]'::jsonb) INTO pre_seats FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO released_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id AND s.left_at IS NULL;
 before_history:=jsonb_build_object('awards',a.money_snapshot->'awards','bounty_awards',a.money_snapshot->'bounty_awards','satellite_awards',a.money_snapshot->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id));
 -- Earned unpaid claims are never silently reclassified as shares.
 IF EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=p_tournament_id AND amount_owed>amount_paid) THEN RAISE EXCEPTION 'equal_share_earned_obligation_unpaid';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND ((status::text='playing') IS DISTINCT FROM (eliminated_at IS NULL))) THEN RAISE EXCEPTION 'equal_share_remaining_roster_ambiguous';END IF;
 SELECT count(*) INTO n FROM public.tournament_players WHERE tournament_id=p_tournament_id AND status::text='playing' AND eliminated_at IS NULL;
 IF n=0 OR EXISTS(SELECT user_id FROM public.tournament_players WHERE tournament_id=p_tournament_id AND status::text='playing' GROUP BY user_id HAVING count(*)<>1 OR user_id IS NULL) THEN RAISE EXCEPTION 'equal_share_remaining_roster_invalid';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p)-'terminal_closed_at' ORDER BY id),'[]') INTO prior_payouts FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id;
 IF a.asset='diamonds' THEN
  SELECT * INTO bank FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id);
  unit_scale:=1;
  PERFORM public.fn_poker_diamond_tournament_open_shadow(p_tournament_id);
 ELSE
  SELECT * INTO bank FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'equal_share_escrow_missing';END IF;
  unit_scale:=100;
 END IF;
 IF bank.prize_balance IS NULL OR bank.bounty_balance IS NULL OR bank.fee_balance IS NULL
 OR bank.prize_balance::text IN('NaN','Infinity','-Infinity') OR bank.bounty_balance::text IN('NaN','Infinity','-Infinity')
 OR bank.fee_balance::text IN('NaN','Infinity','-Infinity')
 OR bank.prize_balance<0 OR bank.bounty_balance<0 OR bank.fee_balance<0
 OR bank.fee_balance*unit_scale<>trunc(bank.fee_balance*unit_scale)
 OR bank.prize_balance*unit_scale<>trunc(bank.prize_balance*unit_scale) OR bank.bounty_balance*unit_scale<>trunc(bank.bounty_balance*unit_scale) THEN RAISE EXCEPTION 'equal_share_bank_units_invalid';END IF;
 prize_units:=bank.prize_balance*unit_scale;bounty_units:=bank.bounty_balance*unit_scale;total_units:=prize_units+bounty_units;
 -- Split the COMBINED bank, preventing two independent remainder allocations.
 -- UUID order fixes the indivisible remainder without a fabricated finish rank.
 FOR recipient IN SELECT id,user_id FROM public.tournament_players WHERE tournament_id=p_tournament_id AND status::text='playing' AND eliminated_at IS NULL ORDER BY user_id LOOP
  ordinal:=ordinal+1;share_units:=trunc(total_units/n)+CASE WHEN ordinal<=mod(total_units,n) THEN 1 ELSE 0 END;
  prize_part:=least(prize_units,share_units);bounty_part:=share_units-prize_part;
  key:='tourney:'||p_tournament_id||':operator-equal-share:'||p_operation_id||':'||recipient.user_id;
  IF prize_part>0 THEN
   IF public.fn_credit_and_log(recipient.user_id,prize_part/unit_scale,key||':prize','prize','Equal share of remaining tournament prize',p_tournament_id,'PLAYER',NULL,NULL,NULL,'operator_abort_equal_share') IS NOT TRUE THEN RAISE EXCEPTION 'equal_share_unexpected_prior_prize_key';END IF;
  END IF;
  IF bounty_part>0 THEN
   IF public.fn_credit_and_log(recipient.user_id,bounty_part/unit_scale,key||':bounty','bounty','Equal share of remaining tournament bounty',p_tournament_id) IS NOT TRUE THEN RAISE EXCEPTION 'equal_share_unexpected_prior_bounty_key';END IF;
  END IF;
  shares:=shares||jsonb_build_array(jsonb_build_object('registration_id',recipient.id,'user_id',recipient.user_id,'amount',share_units/unit_scale,'prize',prize_part/unit_scale,'bounty',bounty_part/unit_scale,'key',key));
  prize_units:=prize_units-prize_part;bounty_units:=bounty_units-bounty_part;
 END LOOP;
 IF prize_units<>0 OR bounty_units<>0 THEN RAISE EXCEPTION 'equal_share_banks_not_conserved';END IF;
 financial:=jsonb_build_object('asset',a.asset,'fully_settled',true,'refunds','[]'::jsonb,'total_refunded',0,'shares',shares,'total_distributed',total_units/unit_scale,'prize_before',bank.prize_balance,'bounty_before',bank.bounty_balance,'fee_before',bank.fee_balance,'unit_scale',unit_scale);
 SELECT CASE WHEN a.asset='diamonds' THEN coalesce(t.total_rake,0) ELSE coalesce(sum(rake_amount),0) END INTO rake_before FROM public.rake_records WHERE tournament_id=p_tournament_id AND is_tournament;
 IF rake_before<0 OR rake_before::text IN('NaN','Infinity','-Infinity') OR (a.asset='chips' AND round(coalesce(t.total_rake,0),2) IS DISTINCT FROM rake_before) THEN RAISE EXCEPTION 'equal_share_rake_cache_mismatch';END IF;
 UPDATE public.tournaments SET status='COMPLETING',current_players=0 WHERE id=p_tournament_id;
 fee_receipt:=public.fn_settle_tournament_rake(p_tournament_id,'operator_abort_equal_share');
 IF fee_receipt->>'ok' IS DISTINCT FROM 'true' OR fee_receipt->>'attributed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'equal_share_fee_settlement_incomplete:%',fee_receipt;END IF;
 rake_after:=rake_before;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0) THEN RAISE EXCEPTION 'operator_abort_escrow_not_exact_zero';END IF;
 UPDATE public.tournament_escrow SET closed_at=settled,close_note=v_close_note,updated_at=now() WHERE tournament_id=p_tournament_id;
 -- A transaction-bound administrative retirement is not a poker bust. The
 -- deferred admission constraint demands this transaction's canonical receipt.
 UPDATE smarter_private.tournament_abort_targets SET receipt=jsonb_build_object('mode','equal_share_retirement_admission','transaction_id',txid_current()) WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id AND state='quiesced';
 -- Keep original eliminated_at, elimination sequence, finish position and prize.
 -- Active remaining virtual stacks are administrative retirements, not results.
 UPDATE public.tournament_players SET status='eliminated',chips=0,current_bounty=0 WHERE tournament_id=p_tournament_id AND status::text<>'eliminated';
 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND (status::text<>'eliminated' OR chips IS DISTINCT FROM 0 OR current_bounty IS DISTINCT FROM 0)) THEN RAISE EXCEPTION 'equal_share_roster_retirement_incomplete';END IF;
 UPDATE public.table_seats s SET left_at=coalesce(s.left_at,settled),status='left',stack=0,leave_pending=false,is_sitting_out=false,is_away=false,sit_out_at=NULL,scheduled_leave_hands=NULL
  FROM public.tables tb WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id;
 UPDATE public.tournaments SET status='CANCELLED',ended_at=settled,updated_at=now(),prize_pool=0,bounty_pool=0,total_rake=rake_after,current_players=0,on_break=false,break_started_at=NULL,break_ends_at=NULL WHERE id=p_tournament_id;
 UPDATE public.tables SET status='closed',lifecycle='closed',current_players=0,terminal_closed_at=settled,updated_at=now() WHERE tournament_id=p_tournament_id;
 after_history:=jsonb_build_object('awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'awards','bounty_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'bounty_awards','satellite_awards',smarter_private.tournament_abort_money_snapshot(p_tournament_id)->'satellite_awards',
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id)::text,'[]')) FROM public.hand_history h WHERE h.tournament_id=p_tournament_id));
 IF EXISTS(SELECT value FROM jsonb_array_elements(prior_payouts) EXCEPT SELECT to_jsonb(p)-'terminal_closed_at' FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id) THEN RAISE EXCEPTION 'equal_share_prior_payout_changed';END IF;
 IF before_history IS DISTINCT FROM after_history THEN RAISE EXCEPTION 'operator_abort_earned_results_or_original_hands_changed:%:%:%:%',before_history,after_history,financial->'prior_awards_preserved',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_obligations o WHERE tournament_id=p_tournament_id AND kind<>'refund');END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO refunded_ids FROM public.tournament_players p WHERE p.tournament_id=p_tournament_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(financial->'refunds') r WHERE (r->>'user_id')::uuid=p.user_id);
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO zero_ids FROM unnest(player_ids) id WHERE NOT id=ANY(refunded_ids);
 v_receipt:=jsonb_build_object('ok',true,'success',true,'fully_settled',true,'receipt_version',4,'mode','started_operator_equal_share','operation_id',p_operation_id,'tournament_id',p_tournament_id,'actor_id',actor,'status','CANCELLED',
 'source_player_count',cardinality(player_ids),'refunded_count',cardinality(refunded_ids),'refund_line_count',jsonb_array_length(financial->'refunds'),'ticket_return_count',0,'ticket_returns','[]'::jsonb,'total_ticket_returned',0,
 'total_refunded',(financial->>'total_refunded')::numeric,'fees_reversed',fees_reversed,'closed_table_count',cardinality(table_ids),'source_seat_count',cardinality(seat_ids),'released_seat_count',cardinality(released_ids),'refunds',financial->'refunds','settled_at',settled,
 'original_started_at',t.started_at,'financial',financial,'fee_receipt',fee_receipt,'pre_abort_roster',pre_roster,'pre_abort_seats',pre_seats,'preserved_history',before_history,'quiescence',a.quiescence,'payout_history',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id),'fee_settlement',(SELECT to_jsonb(r) FROM public.tournament_rake_settlements r WHERE tournament_id=p_tournament_id),'terminal_snapshot',smarter_private.tournament_abort_terminal_snapshot(p_tournament_id));
 v_receipt:=v_receipt||jsonb_build_object('allocation_hash',md5((financial->'shares')::text));
 UPDATE smarter_private.tournament_abort_targets SET state='settled',receipt=v_receipt,settled_at=settled WHERE tournament_id=p_tournament_id AND operation_id=p_operation_id;
 INSERT INTO public.tournament_cancellation_receipts(tournament_id,actor_id,receipt_version,source_player_count,source_player_ids,refunded_count,refunded_registration_ids,refund_line_count,ticket_return_count,ticket_return_ids,total_ticket_returned,zero_refund_count,zero_refund_registration_ids,total_refunded,fees_reversed,total_rake_before,total_rake_after,closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,released_seat_count,released_seat_ids,fee_reversal_ids,escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,receipt,settled_at)
 VALUES(p_tournament_id,actor,4,cardinality(player_ids),player_ids,cardinality(refunded_ids),refunded_ids,jsonb_array_length(financial->'refunds'),0,'{}',0,cardinality(zero_ids),zero_ids,(financial->>'total_refunded')::numeric,fees_reversed,rake_before,rake_after,cardinality(table_ids),table_ids,cardinality(seat_ids),seat_ids,cardinality(released_ids),released_ids,fee_ids,settled,v_close_note,NULL,v_receipt,settled);

 RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id);
END $function$
;
-- Preserve the live all-zero field refusal. Only an exact administrative
-- retirement admitted by the same private settlement transaction may pass it.
DO $migration$DECLARE source text;needle text:='    IF v_status IN (''COMPLETED'', ''CANCELLED'', ''CANCELED'') THEN';BEGIN
 source:=pg_get_functiondef('public.fn_refuse_zero_chip_field_elimination()'::regprocedure);
 IF position(needle IN source)=0 THEN RAISE EXCEPTION 'equal_share_zero_field_guard_preimage';END IF;
 EXECUTE replace(source,needle,$patch$    IF v_status='COMPLETING' AND NEW.chips=0 AND NEW.current_bounty=0
     AND to_jsonb(NEW)-ARRAY['status','chips','current_bounty','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['status','chips','current_bounty','updated_at']
     AND EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a WHERE a.tournament_id=NEW.tournament_id AND a.state='quiesced'
       AND a.receipt->>'mode'='equal_share_retirement_admission' AND (a.receipt->>'transaction_id')::bigint=txid_current()) THEN RETURN NEW;END IF;
$patch$||needle);
END $migration$;
CREATE FUNCTION smarter_private.equal_share_retirement_must_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
BEGIN
 IF NEW.receipt->>'mode'='equal_share_retirement_admission' THEN
  IF NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a JOIN public.tournament_cancellation_receipts h USING(tournament_id)
   WHERE a.tournament_id=NEW.tournament_id AND a.operation_id=NEW.operation_id AND a.state='settled' AND h.receipt_version=4 AND h.receipt=a.receipt)
  THEN RAISE EXCEPTION 'equal_share_retirement_requires_terminal_receipt' USING ERRCODE='23514';END IF;
  PERFORM smarter_private.tournament_equal_share_receipt(NEW.tournament_id,NULL);
 END IF;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.equal_share_retirement_must_close() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER equal_share_retirement_must_close AFTER UPDATE ON smarter_private.tournament_abort_targets
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION smarter_private.equal_share_retirement_must_close();

CREATE FUNCTION smarter_private.tournament_equal_share_receipt(p_tournament_id uuid,p_observed_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE h public.tournament_cancellation_receipts;t public.tournaments;a smarter_private.tournament_abort_targets;line jsonb;roster jsonb;ordinal bigint;count_players integer;scale numeric;units numeric;total numeric:=0;prize numeric:=0;bounty numeric:=0;
BEGIN
 SELECT * INTO h FROM public.tournament_cancellation_receipts WHERE tournament_id=p_tournament_id;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE tournament_id=p_tournament_id;
 IF h.receipt_version IS DISTINCT FROM 4 OR h.receipt->>'mode' IS DISTINCT FROM 'started_operator_equal_share'
 OR a.state IS DISTINCT FROM 'settled' OR h.receipt IS DISTINCT FROM a.receipt OR h.receipt->>'operation_id' IS DISTINCT FROM a.operation_id::text
 OR h.receipt->'fully_settled' IS DISTINCT FROM 'true'::jsonb OR t.status IS DISTINCT FROM 'CANCELLED'
 OR t.started_at IS DISTINCT FROM (h.receipt->>'original_started_at')::timestamptz OR t.ended_at IS DISTINCT FROM h.settled_at
 OR t.current_players IS DISTINCT FROM 0 OR t.prize_pool IS DISTINCT FROM 0::numeric OR t.bounty_pool IS DISTINCT FROM 0::numeric
 OR t.total_rake IS DISTINCT FROM h.total_rake_after OR t.on_break IS DISTINCT FROM false OR t.break_started_at IS NOT NULL OR t.break_ends_at IS NOT NULL
 OR (p_observed_actor_id IS NOT NULL AND h.actor_id IS DISTINCT FROM p_observed_actor_id)
 OR h.receipt->'terminal_snapshot' IS DISTINCT FROM smarter_private.tournament_abort_terminal_snapshot(p_tournament_id)
 OR h.receipt->'fee_settlement' IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.tournament_rake_settlements r WHERE tournament_id=p_tournament_id)
 OR h.receipt->>'payout_history' IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]')) FROM public.tournament_payouts p WHERE tournament_id=p_tournament_id)
 OR h.receipt->>'allocation_hash' IS DISTINCT FROM md5((h.receipt->'financial'->'shares')::text)
 OR jsonb_typeof(h.receipt->'financial'->'shares') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'equal_share_terminal_receipt_evidence_changed' USING ERRCODE='P0404';END IF;
 IF EXISTS(SELECT 1 FROM (VALUES ('total_distributed'),('prize_before'),('bounty_before'),('fee_before'),('unit_scale')) key(name)
 WHERE jsonb_typeof(h.receipt->'financial'->key.name) IS DISTINCT FROM 'number' OR (h.receipt->'financial'->>key.name)::numeric<0
 OR (h.receipt->'financial'->>key.name)::numeric::text IN('NaN','Infinity','-Infinity'))
 OR h.receipt->'fee_receipt'->'ok' IS DISTINCT FROM 'true'::jsonb OR h.receipt->'fee_receipt'->'attributed' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(h.receipt->'fee_receipt'->'amount') IS DISTINCT FROM 'number' OR (h.receipt->'fee_receipt'->>'amount')::numeric<0
 OR (h.receipt->'fee_receipt'->>'amount')::numeric::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'equal_share_receipt_financial_scalar_invalid';END IF;
 count_players:=jsonb_array_length(h.receipt->'financial'->'shares');
 scale:=CASE WHEN a.asset='diamonds' THEN 1 ELSE 100 END;
 units:=((h.receipt->'financial'->>'prize_before')::numeric+(h.receipt->'financial'->>'bounty_before')::numeric)*scale;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'user_id'),'[]') INTO roster FROM jsonb_array_elements(h.receipt->'pre_abort_roster') WHERE value->>'status'='playing' AND value->'eliminated_at'='null'::jsonb;
 IF count_players=0 OR count_players<>jsonb_array_length(roster) OR units<0 OR units<>trunc(units) OR (h.receipt->'financial'->>'unit_scale')::numeric IS DISTINCT FROM scale THEN RAISE EXCEPTION 'equal_share_receipt_roster_or_units_invalid';END IF;
 FOR line,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(h.receipt->'financial'->'shares') WITH ORDINALITY LOOP
  IF EXISTS(SELECT 1 FROM (VALUES ('amount'),('prize'),('bounty')) key(name)
   WHERE jsonb_typeof(line->key.name) IS DISTINCT FROM 'number' OR (line->>key.name)::numeric<0
   OR (line->>key.name)::numeric::text IN('NaN','Infinity','-Infinity')
   OR (line->>key.name)::numeric*scale IS DISTINCT FROM trunc((line->>key.name)::numeric*scale)) THEN RAISE EXCEPTION 'equal_share_receipt_share_scalar_invalid';END IF;
  IF line->>'user_id' IS DISTINCT FROM roster->(ordinal-1)::integer->>'user_id' OR line->>'registration_id' IS DISTINCT FROM roster->(ordinal-1)::integer->>'id'
  OR (line->>'amount')::numeric*scale IS DISTINCT FROM (trunc(units/count_players)+CASE WHEN ordinal<=mod(units,count_players) THEN 1 ELSE 0 END)
  OR line->>'key' IS DISTINCT FROM 'tourney:'||p_tournament_id||':operator-equal-share:'||a.operation_id||':'||(line->>'user_id')
  OR (line->>'prize')::numeric<0 OR (line->>'bounty')::numeric<0 THEN RAISE EXCEPTION 'equal_share_receipt_allocation_changed';END IF;
  total:=total+(line->>'amount')::numeric;prize:=prize+(line->>'prize')::numeric;bounty:=bounty+(line->>'bounty')::numeric;
  IF (line->>'amount')::numeric IS DISTINCT FROM (line->>'prize')::numeric+(line->>'bounty')::numeric THEN RAISE EXCEPTION 'equal_share_receipt_sum_changed';END IF;
  IF (line->>'prize')::numeric>0 AND NOT EXISTS(SELECT 1 FROM public.wallet_credit_idempotency WHERE key=(line->>'key')||':prize' AND user_id=(line->>'user_id')::uuid AND amount=(line->>'prize')::numeric) THEN RAISE EXCEPTION 'equal_share_prize_credit_missing';END IF;
  IF (line->>'bounty')::numeric>0 AND NOT EXISTS(SELECT 1 FROM public.wallet_credit_idempotency WHERE key=(line->>'key')||':bounty' AND user_id=(line->>'user_id')::uuid AND amount=(line->>'bounty')::numeric) THEN RAISE EXCEPTION 'equal_share_bounty_credit_missing';END IF;
 END LOOP;
 IF total IS DISTINCT FROM (h.receipt->'financial'->>'total_distributed')::numeric OR prize IS DISTINCT FROM (h.receipt->'financial'->>'prize_before')::numeric OR bounty IS DISTINCT FROM (h.receipt->'financial'->>'bounty_before')::numeric THEN RAISE EXCEPTION 'equal_share_receipt_bank_conservation_changed';END IF;
 RETURN h.receipt;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.tournament_equal_share_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$DECLARE source text;needle text:='  IF v_h.receipt_version=3 AND';BEGIN
 source:=pg_get_functiondef('public.fn_ca_tournament_cancellation_receipt(uuid,uuid)'::regprocedure);
 IF position(needle IN source)=0 THEN RAISE EXCEPTION 'equal_share_reader_preimage';END IF;
 EXECUTE replace(source,needle,E'  IF v_h.receipt_version=4 THEN RETURN smarter_private.tournament_equal_share_receipt(p_tournament_id,p_observed_actor_id);END IF;\n'||needle);
END $migration$;
REVOKE ALL ON FUNCTION public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text) TO service_role;

-- Explicit financial preflight: the exact settlement and every deferred check
-- execute inside a subtransaction that is unconditionally rolled back.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes)
VALUES('fn_ca_preview_tournament_abort_equal_share','approved','Explicit noncommitting preview of canonical equal-share settlement; never commits awards') ON CONFLICT(proname) DO NOTHING;
DO $migration$BEGIN IF NOT EXISTS(SELECT 1 FROM public.ca_money_rpc_registry WHERE proname='fn_ca_preview_tournament_abort_equal_share' AND status='approved') THEN RAISE EXCEPTION 'equal_share_preview_authority_not_approved' USING ERRCODE='42501';END IF;END $migration$;
CREATE FUNCTION public.fn_ca_preview_tournament_abort_equal_share(p_operation_id uuid,p_tournament_id uuid,p_expected_money_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE preview_receipt jsonb; completed boolean:=false;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 BEGIN
  preview_receipt:=public.fn_ca_settle_tournament_abort_equal_share(p_operation_id,p_tournament_id,p_expected_money_hash);
  SET CONSTRAINTS ALL IMMEDIATE;
  completed:=true;
  RAISE EXCEPTION 'equal_share_preview_forced_rollback' USING ERRCODE='P0E01';
 EXCEPTION WHEN SQLSTATE 'P0E01' THEN
  IF NOT completed OR SQLERRM<>'equal_share_preview_forced_rollback' THEN RAISE;END IF;
 END;
 RETURN jsonb_build_object('preview_only',true,'rolled_back',true,'operation_id',p_operation_id,'tournament_id',p_tournament_id,'money_hash',p_expected_money_hash,'allocation_hash',preview_receipt->>'allocation_hash','receipt',preview_receipt);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_preview_tournament_abort_equal_share(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_preview_tournament_abort_equal_share(uuid,uuid,text) TO service_role;

COMMIT;
