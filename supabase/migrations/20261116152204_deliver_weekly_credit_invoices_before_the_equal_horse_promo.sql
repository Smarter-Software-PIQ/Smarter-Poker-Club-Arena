-- @live-proof: position('weekly_credit_invoices' in pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure))>0 AND position('all_active_midway_horses' in pg_get_functiondef('public.fn_midway_weekly_horse_promo(timestamptz,timestamptz)'::regprocedure))>0 AND position('deliver_weekly_credit_invoice' in pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

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
  FOR bill IN SELECT b.agent_id,b.amount_owed,a.user_id,i.id invoice_id,i.net_amount,ci.debt_owed
    FROM public.agent_credit_weekly_basis b
    JOIN public.agents a ON a.id=b.agent_id
    LEFT JOIN public.credit_invoices ci ON ci.agent_id=b.agent_id AND ci.period_start=b.period_start AND ci.period_end=b.period_end
    LEFT JOIN public.settlement_invoices i ON i.source_credit_invoice_id=ci.id
    WHERE b.period_start=p_from AND b.period_end=p_to AND b.amount_owed>0 AND b.credit_line>0
    ORDER BY b.club_id,b.agent_id LOOP
    IF bill.invoice_id IS NULL OR bill.debt_owed IS DISTINCT FROM bill.amount_owed OR bill.net_amount IS DISTINCT FROM bill.amount_owed THEN
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
