-- @live-proof: to_regprocedure('smarter_private.weekly_final_credit_documents(timestamptz,timestamptz,boolean)') IS NOT NULL AND position('weekly_rakeback_documents' in pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure))>0
BEGIN;
-- The original release closes admission to new payout scopes for this week.
-- Require each booked scope's original financial receipt before distributing
-- the private documents independently of the club's commercial P&L.
CREATE FUNCTION smarter_private.weekly_agent_documents_released(p_from timestamptz,p_to timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT FROM public.weekly_accounting_payout_pauses p
   WHERE p.instance_id='weekly-payout-rounds' AND p.period_start=p_from AND p.period_end=p_to AND p.phase='released'
     AND p.scope_plan @> '[{"kind":"union","id":"fade0000-0000-0000-0000-000000000001"}]'::jsonb
     AND NOT EXISTS (SELECT FROM jsonb_array_elements(p.scope_plan) s
       WHERE NOT EXISTS(SELECT FROM smarter_private.weekly_payout_financial_receipts r
         WHERE r.scope_kind=s->>'kind' AND r.scope_id=(s->>'id')::uuid
           AND r.period_start=p_from AND r.period_end=p_to)))
 AND NOT EXISTS(SELECT FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=p_to AND p.phase<>'released')
 AND EXISTS(SELECT FROM smarter_private.weekly_payout_financial_receipts r
   WHERE r.scope_kind='union' AND r.scope_id='fade0000-0000-0000-0000-000000000001'
     AND r.period_start=p_from AND r.period_end=p_to);
$$;
REVOKE ALL ON FUNCTION smarter_private.weekly_agent_documents_released(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- The completed marker binds all three document classes to the same closed
-- period. The existing private message and invoice rows remain the originals.
CREATE TABLE smarter_private.weekly_rakeback_document_runs(
  period_end timestamptz PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  club_receipt jsonb NOT NULL,
  kings_welcome_receipt jsonb
);
REVOKE ALL ON smarter_private.weekly_rakeback_document_runs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.weekly_rakeback_documents(p_from timestamptz,p_to timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $phase$
DECLARE clubs jsonb; credits text; issued boolean;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_from IS DISTINCT FROM public.fn_union_prev_week_start(p_to) OR NOT smarter_private.weekly_agent_documents_released(p_from,p_to)
 THEN RETURN 'awaiting_rakeback'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('weekly-rakeback-documents:'||extract(epoch FROM p_to)::text,0));
 IF EXISTS(SELECT FROM smarter_private.weekly_rakeback_document_runs d WHERE d.period_end=p_to) THEN RETURN 'ready'; END IF;
 IF public.fn_platform_frozen() IS NOT FALSE OR public.fn_entry_purchases_frozen() IS NOT FALSE THEN RETURN 'maintenance_window'; END IF;
 -- Both migrations can land independently. No payment or fabricated club
 -- document can pass while the publisher is unavailable.
 IF to_regprocedure('smarter_private.weekly_club_rakeback_statements(uuid,timestamptz)') IS NULL THEN
   RETURN 'awaiting_club_rakeback_statements';
 END IF;
 clubs:=smarter_private.weekly_club_rakeback_statements('fade0000-0000-0000-0000-000000000001',p_to);
 IF clubs->>'success' IS DISTINCT FROM 'true' THEN RETURN 'awaiting_club_rakeback_statements'; END IF;
 credits:=smarter_private.weekly_final_credit_documents(p_from,p_to,true);
 issued:=smarter_private.weekly_agent_statements_due(p_from,p_to);
 IF credits NOT IN ('invoices_delivered','ready') AND (issued OR credits='partial_credit_delivery' OR coalesce((clubs->>'newly_delivered')::int,0)>0)
 THEN RETURN 'invoices_delivered'; END IF;
 IF credits NOT IN ('invoices_delivered','ready') THEN RETURN credits; END IF;
 IF NOT EXISTS(SELECT FROM smarter_private.weekly_agent_statement_runs r WHERE r.period_end=p_to) THEN
   RETURN 'awaiting_agent_statements';
 END IF;
 INSERT INTO smarter_private.weekly_rakeback_document_runs(period_end,club_receipt) VALUES(p_to,clubs);
 RETURN 'invoices_delivered'; -- commit deliveries before the financial transaction
END $phase$;
REVOKE ALL ON FUNCTION smarter_private.weekly_rakeback_documents(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

DO $install$
DECLARE src text; bill_block text; bill_start text:='  prior:=current_setting'; bill_end text:='  IF NOT sent AND p_to';
  book_gate text:='IF book->>''success'' IS DISTINCT FROM ''true'' OR jsonb_typeof(book->''detail'') IS DISTINCT FROM ''array''';
  horizon text:='  IF n < due OR n >= due + interval ''12 hours'' THEN RETURN smarter_private.weekly_kings_welcome_due(); END IF;';
  books_start text:='  SELECT h.period_end INTO pending_statement_week'; books_end text:='  IF n < due';
BEGIN
 src:=pg_get_functiondef('smarter_private.weekly_agent_statements_due(timestamptz,timestamptz)'::regprocedure);
 IF strpos(src,book_gate)=0 THEN RAISE EXCEPTION 'weekly_agent_statement_payment_gate_changed'; END IF;
 -- Keep the completed historical book route; a genuinely released scope can
 -- also use its frozen agreement membership and original paid period now.
 EXECUTE replace(src,book_gate,'IF ('||substr(book_gate,4)||') AND NOT smarter_private.weekly_agent_documents_released(p_from,p_to)');

 src:=pg_get_functiondef('smarter_private.weekly_credit_invoices(timestamptz,timestamptz)'::regprocedure);
 IF strpos(src,bill_start)=0 OR strpos(src,bill_end)<=strpos(src,bill_start) THEN
   RAISE EXCEPTION 'weekly_credit_document_owner_changed';
 END IF;
 bill_block:=substr(src,strpos(src,bill_start),strpos(src,bill_end)-strpos(src,bill_start));
 -- Both callers use the same approved reduction check, original document,
 -- recipient-specific Messenger proof and delivery operation. Serialize just
 -- those writes if the promo gate and books owner arrive at the same time.
 EXECUTE $body$CREATE FUNCTION smarter_private.weekly_final_credit_documents(p_from timestamptz,p_to timestamptz,p_only_final boolean)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $credit$
 DECLARE bill record; prior text; sent boolean:=false; incomplete boolean:=false;
 BEGIN
   IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('weekly-credit-documents:'||extract(epoch FROM p_to)::text,0));
 $body$||replace(bill_block,'RETURN ''awaiting_agent_credit_document'';',
     'IF p_only_final THEN incomplete:=true; CONTINUE; END IF; RETURN ''awaiting_agent_credit_document'';')||$body$
   IF incomplete THEN RETURN CASE WHEN sent THEN 'partial_credit_delivery' ELSE 'awaiting_agent_credit_document' END; END IF;
   RETURN CASE WHEN sent THEN 'invoices_delivered' ELSE 'ready' END;
 END $credit$;$body$;
 EXECUTE replace(src,bill_block,$delegate$  prior:=smarter_private.weekly_final_credit_documents(p_from,p_to,false);
  IF prior NOT IN ('invoices_delivered','ready') THEN RETURN prior; END IF;
  sent:=sent OR prior='invoices_delivered';
$delegate$);

 src:=pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure);
 IF strpos(src,books_start)=0 OR strpos(src,books_end)<=strpos(src,books_start) THEN
   RAISE EXCEPTION 'weekly_union_books_private_statement_backlog_changed';
 END IF;
 -- One short, committed visit for private documents. On the next visit a
 -- completed cohort no longer owns the tick; blocked/missing credit documents
 -- also let the original club close advance. No second job or payout call.
 src:=replace(src,substr(src,strpos(src,books_start),strpos(src,books_end)-strpos(src,books_start)),$early$
  IF public.fn_platform_frozen() IS FALSE AND public.fn_entry_purchases_frozen() IS FALSE THEN
    SELECT p.period_end INTO pending_statement_week FROM public.weekly_accounting_payout_pauses p
     WHERE p.instance_id='weekly-payout-rounds' AND p.phase='released' AND p.period_end>='2026-11-16 08:00Z'
       AND smarter_private.weekly_agent_documents_released(public.fn_union_prev_week_start(p.period_end),p.period_end)
       AND (NOT EXISTS (SELECT FROM smarter_private.weekly_rakeback_document_runs d WHERE d.period_end=p.period_end)
         OR NOT EXISTS (SELECT FROM public.union_weekly_horse_promo_runs h
              WHERE h.union_id='fade0000-0000-0000-0000-000000000001' AND h.period_end=p.period_end)
         OR EXISTS(SELECT FROM public.union_weekly_horse_promo_runs h
              WHERE h.union_id='fade0000-0000-0000-0000-000000000001' AND h.period_end=p.period_end
                AND NOT EXISTS(SELECT FROM smarter_private.weekly_rakeback_document_runs d WHERE d.period_end=h.period_end AND d.kings_welcome_receipt IS NOT NULL)
                AND NOT EXISTS(SELECT FROM public.union_accounting_runs r WHERE r.scope_id=h.union_id AND r.scope_kind='union'
                  AND r.period_end=h.period_end AND r.result->'kings_welcome_chips' IS NOT NULL)))
     ORDER BY p.period_end LIMIT 1;
    IF pending_statement_week IS NOT NULL THEN
      DECLARE doc_state text;
      BEGIN
        doc_state:=smarter_private.weekly_rakeback_documents(public.fn_union_prev_week_start(pending_statement_week),pending_statement_week);
        IF doc_state='invoices_delivered' THEN RETURN jsonb_build_object('stage',doc_state); END IF;
        IF doc_state='ready' THEN
          v_tick:=public.fn_midway_weekly_horse_promo_due(pending_statement_week);
          IF v_tick->>'advanced'='true' THEN RETURN v_tick; END IF;
          IF v_tick->>'reason'='already_paid' THEN
            v_tick:=smarter_private.weekly_kings_welcome_due();
            IF v_tick IS NOT NULL THEN RETURN v_tick; END IF;
          END IF;
        END IF;
      END;
    END IF;
  END IF;
$early$);
 IF strpos(src,horizon)=0 OR strpos(src,'v_tick := public.fn_midway_weekly_horse_promo_due();')=0 THEN
   RAISE EXCEPTION 'weekly_union_books_horizon_changed';
 END IF;
 -- Beyond normal intake, resume only periods whose original payout released
 -- and whose own union book or post-book promo still lacks its final receipt.
 -- The ordinary scheduler lock, transaction budget and per-scope guards below
 -- remain in force. A pending welcome already has its own oldest-first lookup.
 src:=replace(src,horizon,$late$  IF n < due OR n >= due + interval '12 hours' THEN
    SELECT p.period_end INTO e FROM public.weekly_accounting_payout_pauses p
     WHERE p.instance_id='weekly-payout-rounds' AND p.phase='released' AND p.period_end>='2026-11-16 08:00Z'
       AND smarter_private.weekly_agent_documents_released(public.fn_union_prev_week_start(p.period_end),p.period_end)
       AND EXISTS (SELECT FROM jsonb_array_elements(p.scope_plan) u WHERE u->>'kind'='union'
         AND (NOT EXISTS(SELECT FROM public.union_accounting_runs r WHERE r.scope_kind='union'
              AND r.scope_id=(u->>'id')::uuid AND r.period_end=p.period_end AND r.status='complete')
           OR ((u->>'id')::uuid='fade0000-0000-0000-0000-000000000001' AND NOT EXISTS(
              SELECT FROM public.union_weekly_horse_promo_runs h WHERE h.union_id=(u->>'id')::uuid AND h.period_end=p.period_end))))
     ORDER BY p.period_end LIMIT 1;
    IF e IS NULL THEN RETURN smarter_private.weekly_kings_welcome_due(); END IF;
  END IF;$late$);
 EXECUTE replace(src,'v_tick := public.fn_midway_weekly_horse_promo_due();','v_tick := public.fn_midway_weekly_horse_promo_due(e);');
 -- Replace only the financial document predicate. The original money owner,
 -- due/freeze conditions, per-week lock, allocations and journal stay intact.
 src:=pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure);
 IF strpos(src,'invoice_stage:=smarter_private.weekly_credit_invoices(v_from,v_to);')=0 THEN
   RAISE EXCEPTION 'weekly_promo_document_gate_changed';
 END IF;
 EXECUTE replace(src,'invoice_stage:=smarter_private.weekly_credit_invoices(v_from,v_to);',
    'invoice_stage:=CASE WHEN v_to>=''2026-11-16 08:00Z'' THEN smarter_private.weekly_rakeback_documents(v_from,v_to) ELSE smarter_private.weekly_credit_invoices(v_from,v_to) END;');
 src:=pg_get_functiondef('public.fn_midway_weekly_horse_promo(timestamptz,timestamptz)'::regprocedure);
 IF strpos(src,'IF public.fn_platform_frozen() THEN RAISE EXCEPTION ''midway_promo_platform_frozen''; END IF;')=0 THEN
   RAISE EXCEPTION 'weekly_horse_payment_entry_changed';
 END IF;
 -- Every actual spend, including a direct service call, requires the completed
 -- documents. Existing paid periods still return their original receipt above.
 EXECUTE replace(src,'IF public.fn_platform_frozen() THEN RAISE EXCEPTION ''midway_promo_platform_frozen''; END IF;',
   $guard$IF p_to>='2026-11-16 08:00Z' AND NOT EXISTS(SELECT FROM smarter_private.weekly_rakeback_document_runs d WHERE d.period_end=p_to)
 THEN RAISE EXCEPTION 'midway_promo_requires_posted_weekly_documents'; END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'midway_promo_platform_frozen'; END IF;$guard$);

 src:=pg_get_functiondef('smarter_private.weekly_kings_welcome_due()'::regprocedure);
 IF strpos(src,'SELECT r.period_start,r.period_end,h.id AS horse_run INTO book')=0 OR strpos(src,'IF NOT FOUND THEN RETURN NULL;')=0
   OR strpos(src,'stage:=smarter_private.weekly_credit_invoices(book.period_start,book.period_end);')=0
   OR strpos(src,'  UPDATE public.union_accounting_runs SET result=jsonb_set')=0 THEN
   RAISE EXCEPTION 'weekly_welcome_document_gate_changed';
 END IF;
 src:=replace(src,substr(src,strpos(src,'SELECT r.period_start,r.period_end,h.id AS horse_run INTO book'),
   strpos(src,'IF NOT FOUND THEN RETURN NULL;')-strpos(src,'SELECT r.period_start,r.period_end,h.id AS horse_run INTO book')),$select$
  SELECT h.period_start,h.period_end,h.id AS horse_run INTO book FROM public.union_weekly_horse_promo_runs h
    JOIN smarter_private.weekly_rakeback_document_runs d ON d.period_end=h.period_end
    WHERE h.union_id=midway AND h.period_end>='2026-11-16 08:00Z' AND d.kings_welcome_receipt IS NULL
      AND NOT EXISTS(SELECT FROM public.union_accounting_runs r WHERE r.scope_kind='union' AND r.scope_id=midway
        AND r.period_end=h.period_end AND r.result->'kings_welcome_chips' IS NOT NULL)
      AND h.result->>'eligibility'='all_active_midway_horses' AND h.result->>'success'='true'
      AND h.paid=CASE WHEN h.eligible_wallets>0 THEN h.budget ELSE 0 END
    ORDER BY h.period_end LIMIT 1 FOR UPDATE OF d SKIP LOCKED;
  $select$);
 src:=replace(src,'stage:=smarter_private.weekly_credit_invoices(book.period_start,book.period_end);',
    'stage:=smarter_private.weekly_rakeback_documents(book.period_start,book.period_end);');
 src:=replace(src,'  UPDATE public.union_accounting_runs SET result=jsonb_set',
    '  UPDATE smarter_private.weekly_rakeback_document_runs SET kings_welcome_receipt=receipt WHERE period_end=book.period_end;'||chr(10)||
    '  UPDATE public.union_accounting_runs SET result=jsonb_set');
 -- Never contend with the unfinished independent ECO certification writer.
 EXECUTE replace(src,'WHERE scope_kind=''union'' AND scope_id=midway AND period_end=book.period_end;',
   'WHERE scope_kind=''union'' AND scope_id=midway AND period_end=book.period_end AND status=''complete'';');
END $install$;
REVOKE ALL ON FUNCTION smarter_private.weekly_final_credit_documents(timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
