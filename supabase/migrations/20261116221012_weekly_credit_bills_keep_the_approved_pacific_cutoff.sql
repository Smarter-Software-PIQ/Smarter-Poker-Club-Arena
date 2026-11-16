-- @live-proof: position('Agent wallet covers the credit line after weekly rakeback' in pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure))=0 AND position('cutoff_credit_document' in pg_get_functiondef('smarter_private.weekly_final_credit_documents(timestamptz,timestamptz,boolean)'::regprocedure))>0
BEGIN;
DO $install$
DECLARE s text; first_line text:=' -- Credit lines: what an agent owes'; next_line text:=' -- Rakeback Received:';
  deliver text:='    IF NOT EXISTS (SELECT FROM public.accounting_invoice_deliveries';
BEGIN
 s:=pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure);
 IF strpos(s,first_line)=0 OR strpos(s,next_line)<=strpos(s,first_line)
    OR strpos(s,'Agent wallet covers the credit line after weekly rakeback')=0 THEN
   RAISE EXCEPTION 'weekly_finalizer_credit_writer_changed';
 END IF;
 -- R2 captured the closing wallet before any weekly payment and created the
 -- original document. Releasing R3 has no authority to reassess this debt.
 EXECUTE substr(s,1,strpos(s,first_line)-1)||substr(s,strpos(s,next_line));

 s:=pg_get_functiondef('smarter_private.weekly_final_credit_documents(timestamptz,timestamptz,boolean)'::regprocedure);
 IF strpos(s,'i.net_amount,ci.debt_owed,')=0 OR strpos(s,'WHERE r.invoice_id=ci.id),0) approved_due')=0
   OR strpos(s,'LEFT JOIN public.settlement_invoices i ON i.source_credit_invoice_id=ci.id')=0
   OR strpos(s,' OR bill.debt_owed IS DISTINCT FROM bill.approved_due')=0 OR strpos(s,deliver)=0
 THEN RAISE EXCEPTION 'weekly_cutoff_document_owner_changed'; END IF;
 s:=replace(s,'i.net_amount,ci.debt_owed,','i.net_amount,ci.debt_owed,ci.id credit_id,');
 s:=replace(s,'WHERE r.invoice_id=ci.id),0) approved_due','WHERE r.invoice_id=ci.id AND r.document_id=i.id),0) approved_due');
 s:=replace(s,'LEFT JOIN public.settlement_invoices i ON i.source_credit_invoice_id=ci.id',$identity$LEFT JOIN public.settlement_invoices i ON i.source_credit_invoice_id=ci.id
      AND i.invoice_type='transaction_receipt' AND i.breakdown->>'kind'='credit_invoice'
      AND i.club_id=b.club_id AND i.from_entity_type='club' AND i.from_entity_id=b.club_id::text
      AND i.to_entity_type='agent' AND i.to_entity_id=a.user_id::text
      AND i.gross_amount=b.amount_owed AND i.deductions=i.gross_amount-i.net_amount$identity$);
 s:=replace(s,' OR bill.debt_owed IS DISTINCT FROM bill.approved_due','');
 -- Billed amount and current collections have distinct owners. The immutable
 -- approved amount controls the historic Messenger copy. For an uncollected
 -- legacy row, normalize solely the pending, unpaid shape the old financial
 -- finalizer rewrote, or its explicit post-rakeback void. Never modify real
 -- payments, disputes, later statements, owner waivers, or the posted invoice.
 EXECUTE overlay(s placing $restore$    -- cutoff_credit_document
    IF bill.debt_owed IS DISTINCT FROM bill.approved_due AND smarter_private.weekly_agent_documents_released(p_from,p_to) THEN
      UPDATE public.credit_invoices c SET debt_owed=bill.approved_due,amount_remaining=bill.approved_due,
        status='pending',void_reason=NULL
      WHERE c.id=bill.credit_id AND c.debt_owed IS DISTINCT FROM bill.approved_due
        AND c.amount_paid=0 AND c.paid_at IS NULL AND c.amount_remaining=c.debt_owed
        AND ((c.status='pending' AND c.void_reason IS NULL) OR
           (c.status='void' AND c.void_reason='Agent wallet covers the credit line after weekly rakeback' AND c.debt_owed=0))
        AND NOT EXISTS(SELECT FROM public.credit_payments p WHERE p.invoice_id=c.id);
    END IF;
$restore$ from strpos(s,deliver) for 0);
END $install$;
COMMIT;
