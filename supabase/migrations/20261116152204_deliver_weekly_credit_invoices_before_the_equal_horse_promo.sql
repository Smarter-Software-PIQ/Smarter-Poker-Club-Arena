-- @live-proof: position('weekly_credit_invoices' in pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure))>0 AND position('all_active_midway_horses' in pg_get_functiondef('public.fn_midway_weekly_horse_promo(timestamptz,timestamptz)'::regprocedure))>0 AND position('deliver_weekly_credit_invoice' in pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

-- Preserve the original calculation and the chain of authorized reductions.
-- Only a still-unpaid weekly bill that has never reached Messenger is editable.
CREATE TABLE smarter_private.weekly_credit_bill_reductions (
  operation_id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.credit_invoices(id),
  document_id uuid NOT NULL REFERENCES public.settlement_invoices(id),
  prior_due numeric NOT NULL, revised_due numeric NOT NULL,
  prior_document jsonb NOT NULL, reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_xid bigint NOT NULL DEFAULT txid_current(),
  CHECK (prior_due>revised_due AND revised_due>0 AND revised_due=round(revised_due,2))
);
CREATE INDEX weekly_credit_bill_reductions_invoice ON smarter_private.weekly_credit_bill_reductions(invoice_id);
REVOKE ALL ON smarter_private.weekly_credit_bill_reductions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_reduce_unsent_weekly_credit_bill(p_document uuid,p_expected numeric,p_revised numeric,p_reason text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE
  doc public.settlement_invoices%ROWTYPE; bill public.credit_invoices%ROWTYPE;
  prev smarter_private.weekly_credit_bill_reductions%ROWTYPE;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_operation IS NULL OR p_document IS NULL OR p_expected IS NULL OR p_revised IS NULL
    OR p_revised::text IN ('NaN','Infinity','-Infinity') OR p_expected::text IN ('NaN','Infinity','-Infinity')
    OR p_expected<=p_revised OR p_revised<=0 OR p_revised<>round(p_revised,2) OR p_expected<>round(p_expected,2)
    OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'invalid_weekly_credit_bill_reduction'; END IF;
  SELECT * INTO STRICT bill FROM public.credit_invoices WHERE id=(SELECT source_credit_invoice_id FROM public.settlement_invoices WHERE id=p_document) FOR UPDATE;
  SELECT * INTO STRICT doc FROM public.settlement_invoices WHERE id=p_document FOR UPDATE;
  SELECT * INTO prev FROM smarter_private.weekly_credit_bill_reductions WHERE operation_id=p_operation;
  IF FOUND THEN
    IF (prev.document_id,prev.prior_due,prev.revised_due,prev.reason) IS DISTINCT FROM (p_document,p_expected,p_revised,p_reason)
      THEN RAISE EXCEPTION 'weekly_credit_bill_operation_reused'; END IF;
    RETURN jsonb_build_object('document',p_document,'invoice',doc.invoice_number,'due',prev.revised_due,'duplicate',true);
  END IF;
  IF doc.breakdown->>'kind' IS DISTINCT FROM 'credit_invoice' OR doc.source_credit_invoice_id IS DISTINCT FROM bill.id
    OR doc.invoice_type<>'transaction_receipt' OR doc.chips_transferred OR doc.from_entity_type<>'club' OR doc.to_entity_type<>'agent'
    OR bill.status NOT IN ('pending','overdue','disputed') OR bill.amount_paid<>0 OR bill.amount_remaining<>p_expected
    OR bill.debt_owed<>p_expected OR doc.net_amount<>p_expected
    OR EXISTS(SELECT FROM public.accounting_invoice_deliveries d WHERE d.invoice_id=doc.id)
    OR NOT EXISTS(SELECT FROM public.agent_credit_weekly_basis b JOIN public.agents a ON a.id=b.agent_id
      WHERE b.club_id=doc.club_id AND a.user_id::text=doc.to_entity_id AND b.agent_id=bill.agent_id
        AND b.period_start=bill.period_start AND b.period_end=bill.period_end AND b.credit_line>0 AND b.amount_owed=doc.gross_amount)
    THEN RAISE EXCEPTION 'only_an_unpaid_undelivered_weekly_credit_bill_can_be_reduced'; END IF;
  INSERT INTO smarter_private.weekly_credit_bill_reductions(operation_id,invoice_id,document_id,prior_due,revised_due,prior_document,reason)
    VALUES(p_operation,bill.id,doc.id,p_expected,p_revised,to_jsonb(doc),p_reason);
  UPDATE public.credit_invoices SET debt_owed=p_revised,amount_remaining=p_revised WHERE id=bill.id;
  UPDATE public.settlement_invoices SET deductions=gross_amount-p_revised,net_amount=p_revised,
    notes=coalesce(notes,'')||E'\nWeekly bill adjustment: '||p_reason WHERE id=doc.id;
  RETURN jsonb_build_object('document',p_document,'invoice',doc.invoice_number,'prior_due',p_expected,'due',p_revised,'duplicate',false);
END $f$;
REVOKE ALL ON FUNCTION public.fn_reduce_unsent_weekly_credit_bill(uuid,numeric,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reduce_unsent_weekly_credit_bill(uuid,numeric,numeric,text,uuid) TO service_role;
DO $guard$
DECLARE s text:=pg_get_functiondef('public.fn_accounting_document_immutable()'::regprocedure);
BEGIN
  IF md5(s)<>'8ec25e2d39e02451020b5ce8e9ec5a1b' THEN RAISE EXCEPTION 'invoice_immutability_preimage_changed'; END IF;
  EXECUTE replace(s,'   issued:=COALESCE(OLD.message_sent,false)', $body$
   IF TG_OP='UPDATE' AND OLD.source_credit_invoice_id IS NOT NULL AND OLD.net_amount>NEW.net_amount
      AND to_jsonb(OLD)-ARRAY['net_amount','deductions','notes']=to_jsonb(NEW)-ARRAY['net_amount','deductions','notes']
      AND NEW.deductions=NEW.gross_amount-NEW.net_amount
      AND EXISTS(SELECT FROM smarter_private.weekly_credit_bill_reductions r
        JOIN public.credit_invoices ci ON ci.id=r.invoice_id WHERE r.document_id=OLD.id AND r.recorded_xid=txid_current()
        AND r.invoice_id=OLD.source_credit_invoice_id AND r.prior_document=to_jsonb(OLD)
        AND r.prior_due=OLD.net_amount AND r.revised_due=NEW.net_amount AND ci.amount_remaining=NEW.net_amount
        AND NEW.notes=coalesce(OLD.notes,'')||E'\nWeekly bill adjustment: '||r.reason)
      AND NOT EXISTS(SELECT FROM public.accounting_invoice_deliveries d WHERE d.invoice_id=OLD.id) THEN RETURN NEW; END IF;
   issued:=COALESCE(OLD.message_sent,false)$body$);
END $guard$;

-- Only the due owner calls this function. Club statements come from the original
-- close. A credit-line bill comes from its existing debt document, never a
-- commission receipt. Deliveries are private to the invoice recipient.
CREATE FUNCTION smarter_private.weekly_credit_invoices(p_from timestamptz,p_to timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE
  midway constant uuid:='fade0000-0000-0000-0000-000000000001';
  book jsonb; entry jsonb; bill record; prior text; sent boolean:=false;
BEGIN
  IF NOT EXISTS (SELECT FROM smarter_private.weekly_payout_financial_receipts r WHERE r.scope_kind='union'
    AND r.scope_id=midway AND r.period_start=p_from AND r.period_end=p_to)
    OR EXISTS (SELECT FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=p_to AND p.phase<>'released') THEN
    RETURN 'awaiting_rakeback';
  END IF;
  SELECT result->'round4_invoices' INTO book FROM public.union_accounting_runs
    WHERE scope_kind='union' AND scope_id=midway AND period_start=p_from AND period_end=p_to AND status='complete';
  IF book->>'success' IS DISTINCT FROM 'true' OR jsonb_typeof(book->'detail') IS DISTINCT FROM 'array' THEN RETURN 'awaiting_club_invoices'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(book->'detail') LOOP
    IF (entry->>'club_id')::uuid=midway THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id
      JOIN public.fn_accounting_invoice_party_users('club',(entry->>'club_id')::uuid) u ON u.user_id=d.recipient_id
      WHERE d.invoice_id=(entry->>'invoice_id')::uuid) THEN
      PERFORM public.fn_deliver_accounting_invoice((entry->>'invoice_id')::uuid);
      IF NOT EXISTS (SELECT FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id
        JOIN public.fn_accounting_invoice_party_users('club',(entry->>'club_id')::uuid) u ON u.user_id=d.recipient_id
        WHERE d.invoice_id=(entry->>'invoice_id')::uuid) THEN RETURN 'awaiting_club_invoices'; END IF;
      sent:=true;
    END IF;
  END LOOP;
  prior:=current_setting('app.deliver_weekly_credit_invoice',true);
  FOR bill IN SELECT b.agent_id,b.amount_owed,a.user_id,i.id invoice_id,i.net_amount,ci.debt_owed,
    b.amount_owed-coalesce((SELECT sum(r.prior_due-r.revised_due) FROM smarter_private.weekly_credit_bill_reductions r WHERE r.invoice_id=ci.id),0) approved_due
    FROM public.agent_credit_weekly_basis b
    JOIN public.agents a ON a.id=b.agent_id
    LEFT JOIN public.credit_invoices ci ON ci.agent_id=b.agent_id AND ci.period_start=b.period_start AND ci.period_end=b.period_end
    LEFT JOIN public.settlement_invoices i ON i.source_credit_invoice_id=ci.id
    WHERE b.period_start=p_from AND b.period_end=p_to AND b.amount_owed>0 AND b.credit_line>0
    ORDER BY b.club_id,b.agent_id LOOP
    IF bill.invoice_id IS NULL OR bill.debt_owed IS DISTINCT FROM bill.approved_due OR bill.net_amount IS DISTINCT FROM bill.approved_due THEN
      RETURN 'awaiting_agent_credit_document';
    END IF;
    IF NOT EXISTS (SELECT FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id
      WHERE d.invoice_id=bill.invoice_id AND d.recipient_id=bill.user_id) THEN
      PERFORM set_config('app.deliver_weekly_credit_invoice',bill.invoice_id::text,true);
      PERFORM public.fn_deliver_accounting_invoice(bill.invoice_id);
      PERFORM set_config('app.deliver_weekly_credit_invoice',coalesce(prior,''),true);
      IF NOT EXISTS (SELECT FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id
        WHERE d.invoice_id=bill.invoice_id AND d.recipient_id=bill.user_id) THEN RETURN 'awaiting_agent_credit_delivery'; END IF;
      sent:=true;
    END IF;
  END LOOP;
  RETURN CASE WHEN sent THEN 'invoices_delivered' ELSE 'ready' END;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_credit_invoices(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE s text; a int; z int;
BEGIN
  s:=pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure);
  IF md5(s)<>'6b4e9a1bf13238c8e541416515a0870e' THEN RAISE EXCEPTION 'credit_invoice_delivery_preimage_changed'; END IF;
  s:=replace(s,'IF inv.invoice_type IS DISTINCT FROM ''cashier_cashout''', $body$IF NOT (coalesce(current_setting('app.deliver_weekly_credit_invoice',true),'')=inv.id::text
      AND inv.source_credit_invoice_id IS NOT NULL AND inv.breakdown->>'kind'='credit_invoice'
      AND inv.to_entity_type='agent' AND inv.from_entity_type='club')
    AND inv.invoice_type IS DISTINCT FROM 'cashier_cashout'$body$);
  s:=replace(s,'IF inv.from_entity_type=''club'' AND inv.to_entity_type IN(''agent'',''player'')',
    'IF inv.source_credit_invoice_id IS NOT NULL OR inv.from_entity_type=''club'' AND inv.to_entity_type IN(''agent'',''player'')');
  EXECUTE s;
  s:=pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure);
  IF md5(s)<>'09b663f056ccfc381807ba93142f49d9' THEN RAISE EXCEPTION 'weekly_promo_due_preimage_changed'; END IF;
  s:=replace(s,'v_report uuid;','v_report uuid; invoice_stage text;');
  s:=replace(s,' v_result:=public.fn_midway_weekly_horse_promo(v_from,v_to);',$body$
  invoice_stage:=smarter_private.weekly_credit_invoices(v_from,v_to);
  IF invoice_stage<>'ready' THEN
    RETURN jsonb_build_object('success',true,'advanced',invoice_stage='invoices_delivered',
      'owns_tick',invoice_stage='invoices_delivered','stage',invoice_stage);
  END IF;
  v_result:=public.fn_midway_weekly_horse_promo(v_from,v_to);
  UPDATE public.union_accounting_runs SET result=jsonb_set(result,'{weekly_horse_promo}',v_result-'replayed')
    WHERE scope_kind='union' AND scope_id='fade0000-0000-0000-0000-000000000001' AND period_start=v_from AND period_end=v_to AND status='complete'
      AND result->'weekly_horse_promo' IS DISTINCT FROM (v_result-'replayed');$body$);
  EXECUTE replace(s,'horses that played raked cash or tournament hands','active Midway horses');
  s:=pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure);
  IF md5(s)<>'79347a20359977ac7b203eac9ac25c87' THEN RAISE EXCEPTION 'weekly_books_due_preimage_changed'; END IF;
  EXECUTE replace(s,'IF v_open IS NULL OR jsonb_array_length(v_open) = 0 THEN RETURN NULL; END IF;', $body$IF v_open IS NULL OR jsonb_array_length(v_open)=0 THEN
    IF EXISTS (SELECT FROM public.union_accounting_runs r WHERE r.scope_id='fade0000-0000-0000-0000-000000000001' AND r.scope_kind='union' AND r.period_end=e AND r.status='complete')
      AND NOT EXISTS (SELECT FROM public.union_weekly_horse_promo_runs r WHERE r.union_id='fade0000-0000-0000-0000-000000000001' AND r.period_end=e) THEN
      RETURN public.fn_midway_weekly_horse_promo_due(e);
    END IF;
    RETURN NULL;
  END IF;$body$);
  s:=pg_get_functiondef('public.fn_midway_weekly_horse_promo(timestamptz,timestamptz)'::regprocedure);
  IF md5(s)<>'b061d12f1f071bf89c76470e8153f988' THEN RAISE EXCEPTION 'weekly_horse_cohort_preimage_changed'; END IF;
  a:=position(' -- RAKE-GENERATING HORSES ONLY' in s); z:=position(' -- Take the existing stats-user gates' in s);
  IF a=0 OR z<=a THEN RAISE EXCEPTION 'horse_cohort_source_changed'; END IF;
  s:=substr(s,1,a-1)||substr(s,z);
  s:=replace(s,' v_raked text[]; rw record;','');
  s:=replace(s,' AND (m.club_id::text||'':''||m.user_id::text)=ANY(v_raked)','');
  -- One share per horse. For a horse with several active memberships, pay
  -- its longest-standing eligible club wallet; use club ID to break a tie.
  s:=replace(s,'WITH eligible AS MATERIALIZED ('||chr(10)||'  SELECT m.club_id,m.user_id,m.chip_balance AS opening_balance','WITH eligible AS MATERIALIZED ('||chr(10)||'  SELECT DISTINCT ON (m.user_id) m.club_id,m.user_id,m.chip_balance AS opening_balance');
  s:=replace(s,' ), coverage AS MATERIALIZED (','   ORDER BY m.user_id,m.joined_at NULLS LAST,m.club_id'||chr(10)||' ), coverage AS MATERIALIZED (');
  EXECUTE replace(s,'horses_that_generated_rake_this_week','all_active_midway_horses');
END $patch$;
COMMIT;
