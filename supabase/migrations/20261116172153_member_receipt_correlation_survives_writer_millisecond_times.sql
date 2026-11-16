-- A receipt and its wallet leg share operation identity, not necessarily a clock timestamp.
-- Real promo-wallet writers book the two records milliseconds apart.
-- Keep amount, party, wallet and bounded timestamp checks; unmatched legs stay visible.
-- Function-only reporting correction. No financial writes, hot-table DDL or engine dependency.
-- @live-proof: (SELECT pg_get_functiondef('public.ca_member_activity_tx_totals(uuid,uuid[],timestamptz,timestamptz)'::regprocedure) LIKE '%cl.correlation_id%')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $history$
DECLARE
 target regprocedure:='public.fn_member_transaction_history(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,text)'::regprocedure;
 body text:=pg_get_functiondef(target);
 needle constant text:=$before$       OR (ct.created_at=cl.created_at AND abs(ct.amount)=abs(cl.amount) AND (
         (cl.correlation_id IS NOT NULL AND ct.metadata->>'op_id'=cl.correlation_id::text)
         OR ((ct.from_user_id=cl.from_entity_id OR ct.to_user_id=cl.to_entity_id)
           AND (public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata) IS NULL
                OR public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)=cl.from_type
                OR (public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)='club_bank' AND cl.from_type='club_treasury'))
           AND (ct.metadata->>'destination' IS NULL OR ct.metadata->>'destination'=cl.to_type)
           AND (ct.from_user_id IS NULL OR ct.from_user_id=cl.from_entity_id
                OR ct.transaction_type IN ('club_bank_send','horse_treasury_funding','club_promo_send','promo_disbursement','union_member_send','union_promo_send'))
           AND (ct.to_user_id IS NULL OR ct.to_user_id=cl.to_entity_id
                OR ct.transaction_type IN ('club_bank_claim','admin_removal','club_bank_reversal')))))))$before$;
 replacement constant text:=$after$       OR (abs(ct.amount)=abs(cl.amount)
         AND (ct.created_at=cl.created_at OR
           (cl.correlation_id IS NOT NULL AND ct.metadata->>'op_id'=cl.correlation_id::text))
         AND (ct.from_user_id=cl.from_entity_id OR ct.to_user_id=cl.to_entity_id)
         AND (public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata) IS NULL
              OR public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)=cl.from_type
              OR (public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)='club_bank' AND cl.from_type='club_treasury'))
         AND (ct.metadata->>'destination' IS NULL OR ct.metadata->>'destination'=cl.to_type)
         AND (ct.from_user_id IS NULL OR ct.from_user_id=cl.from_entity_id
              OR ct.transaction_type IN ('club_bank_send','horse_treasury_funding','club_promo_send','promo_disbursement','union_member_send','union_promo_send'))
         AND (ct.to_user_id IS NULL OR ct.to_user_id=cl.to_entity_id
              OR ct.transaction_type IN ('club_bank_claim','admin_removal','club_bank_reversal')))))$after$;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target)<>'f8af71e79691beb205dd5821366c5c4a'
   OR (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Member history source changed before millisecond correlation installation';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $history$;
DO $activity$
DECLARE
 target regprocedure:='public.ca_member_activity_tx_totals(uuid,uuid[],timestamptz,timestamptz)'::regprocedure;
 body text:=pg_get_functiondef(target);
 needle constant text:=$before$AND ct.created_at=cl.created_at AND abs(ct.amount)=abs(cl.amount)$before$;
 replacement constant text:=$after$AND ct.created_at BETWEEN cl.created_at-interval '1 minute' AND cl.created_at+interval '1 minute'
    AND (ct.created_at=cl.created_at OR
      (cl.correlation_id IS NOT NULL AND ct.metadata->>'op_id'=cl.correlation_id::text))
    AND abs(ct.amount)=abs(cl.amount)$after$;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target)<>'7c394742e4321ddf5255892fcfb6ebcf'
   OR (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Member activity source changed before millisecond correlation installation';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $activity$;
COMMIT;
