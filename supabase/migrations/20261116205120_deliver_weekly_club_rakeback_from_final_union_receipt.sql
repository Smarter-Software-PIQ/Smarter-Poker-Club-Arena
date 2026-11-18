-- @live-proof: to_regprocedure('smarter_private.weekly_club_rakeback_statements(uuid,timestamptz)') IS NOT NULL AND position('weekly_club_rakeback_documents' in pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))>0
BEGIN;

CREATE TABLE smarter_private.weekly_club_rakeback_documents (
  union_id uuid NOT NULL,
  period_end timestamptz NOT NULL,
  club_id uuid NOT NULL,
  settlement_id uuid NOT NULL REFERENCES public.ca_settlements(id),
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.settlement_invoices(id),
  audience uuid[] NOT NULL CHECK (cardinality(audience)>0),
  fees numeric NOT NULL CHECK (fees>=0),
  rakeback numeric NOT NULL CHECK (rakeback>=0 AND rakeback<=fees),
  player_net numeric,
  player_net_source text,
  PRIMARY KEY(union_id,period_end,club_id)
);
REVOKE ALL ON smarter_private.weekly_club_rakeback_documents FROM PUBLIC,anon,authenticated,service_role;

-- A record-only balance of zero is acceptable only after its original club receipt
-- was delivered. It never counts as a Messenger delivery of the later balance document.
CREATE FUNCTION smarter_private.weekly_zero_balance_document(i public.settlement_invoices)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,smarter_private AS $f$
 SELECT CASE WHEN i.invoice_type='union_weekly_squareup' AND i.net_amount=0 THEN
   (i.breakdown->>'outstanding')::numeric=0 AND EXISTS(
     SELECT FROM smarter_private.weekly_club_rakeback_documents d
     WHERE d.union_id=(i.breakdown->>'union_id')::uuid AND d.club_id=i.club_id
       AND d.period_end=(i.breakdown->>'period_end')::timestamptz AND d.invoice_id<>i.id) ELSE false END
$f$;

CREATE FUNCTION smarter_private.weekly_club_rakeback_statements(p_union uuid,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $f$
DECLARE
  receipt smarter_private.weekly_payout_financial_receipts%ROWTYPE;
  settlement public.ca_settlements%ROWTYPE;
  item record; existing smarter_private.weekly_club_rakeback_documents%ROWTYPE;
  document public.settlement_invoices%ROWTYPE;
  invoice uuid; period uuid; recipients uuid[]; actual uuid[]; names_club uuid[];
  week_start timestamptz; first_round jsonb; qualified_report jsonb;
  wl numeric; wl_source text; result jsonb; clubs integer:=0; delivered integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('weekly-club-rakeback-documents:'||p_union::text||':'||extract(epoch FROM p_end)::text,0));
  SELECT * INTO receipt FROM smarter_private.weekly_payout_financial_receipts WHERE
    scope_kind='union' AND scope_id=p_union AND period_end=p_end;
  IF NOT FOUND OR NOT EXISTS(SELECT FROM public.weekly_accounting_payout_pauses p
    WHERE p.run_id=receipt.run_id AND p.instance_id='weekly-payout-rounds' AND p.period_end=p_end AND p.phase='released') THEN
    RETURN jsonb_build_object('success',false,'stage','awaiting_payout_release');
  END IF;
  week_start:=receipt.period_start;
  SELECT x->'receipt' INTO STRICT first_round FROM jsonb_array_elements(receipt.original_round_receipts) x
    WHERE x->>'round'='1' AND x->'receipt'->>'success'='true';
  SELECT * INTO STRICT settlement FROM public.ca_settlements s WHERE s.id=(first_round->>'settlement_id')::uuid
    AND s.union_id=p_union AND s.state='final' AND s.settlement_type='union_rakeback_close'
    AND s.external_ref=p_union::text||':'||to_char(week_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
    AND s.totals->>'conservation'='asserted'
    AND (s.totals->>'payout_total')::numeric=(first_round->>'total_rakeback')::numeric
    AND (s.totals->>'period_rake')::numeric=(first_round->>'period_rake')::numeric;
  -- Original contract evidence, including departed payees with fees. A club with
  -- no earning source belongs to this week only when on the roster at its cutoff.
  SELECT array_agg(id ORDER BY id) INTO names_club FROM (
    SELECT (a.after_terms->>'club_id')::uuid id FROM (
      SELECT DISTINCT ON (h.entity_key) h.after_terms FROM public.accounting_agreement_history h
      WHERE h.entity_type='union_clubs' AND h.observed_at<p_end
      ORDER BY h.entity_key,h.observed_at DESC,h.id DESC
    ) a WHERE a.after_terms->>'union_id'=p_union::text
    UNION SELECT k::uuid FROM jsonb_object_keys(settlement.totals->'basis_by_club') k
    UNION SELECT k::uuid FROM jsonb_object_keys(settlement.totals->'payout_by_club') k
  ) c WHERE id<>p_union;
  -- A stored, certified current-generation report may already exist on recovery.
  -- Never run a P&L calculation to produce a rakeback document.
  SELECT rr.report INTO qualified_report FROM public.accounting_close_report_receipts rr
  WHERE rr.union_id=p_union AND rr.period_start=week_start AND rr.period_end=p_end
    AND public.fn_accounting_close_report_is_ready(rr.report)
    AND rr.generation=(SELECT coalesce(k.generation,'') FROM public.fn_accounting_close_report_memo_key(p_union,week_start,p_end) k WHERE k.memo_key IS NOT NULL)
    AND rr.computed_at>=p_end AND rr.computed_at>clock_timestamp()-public.fn_accounting_close_proof_lifetime()
    AND NOT EXISTS(SELECT FROM public.accounting_close_certificates c WHERE
      c.union_id=p_union AND c.period_start=week_start AND c.period_end=p_end AND c.certified_at>rr.computed_at
      AND c.kind NOT LIKE 'club\_statement\_quality:%');
  FOR item IN SELECT k id,coalesce((settlement.totals->'basis_by_club'->>k::text)::numeric,0) fees,
    coalesce((settlement.totals->'payout_by_club'->>k::text)::numeric,0) paid FROM unnest(names_club) k LOOP
    clubs:=clubs+1;
    SELECT * INTO existing FROM smarter_private.weekly_club_rakeback_documents WHERE
      union_id=p_union AND period_end=p_end AND club_id=item.id;
    IF FOUND THEN CONTINUE; END IF;
    SELECT array_agg(DISTINCT u ORDER BY u) INTO recipients FROM (
      SELECT user_id u FROM public.fn_accounting_invoice_party_users('club',item.id)
      UNION ALL SELECT user_id FROM public.fn_accounting_invoice_party_users('union',p_union)
    ) audience;
    IF NOT EXISTS(SELECT FROM public.fn_accounting_invoice_party_users('club',item.id))
       OR NOT EXISTS(SELECT FROM public.fn_accounting_invoice_party_users('union',p_union)) THEN
      RAISE EXCEPTION 'weekly_club_rakeback_audience_missing'; END IF;
    -- An already delivered original combined statement covered this notice.
    SELECT i.* INTO document FROM public.settlement_invoices i JOIN public.settlement_periods p ON p.id=i.period_id
    WHERE p.union_id=p_union AND p.club_id=item.id AND p.start_at=week_start AND p.end_at=p_end
      AND i.club_id=item.id AND i.invoice_type='union_weekly_squareup' AND i.status<>'cancelled'
      AND i.breakdown->>'union_id'=p_union::text AND (i.breakdown->>'period_start')::timestamptz=week_start
      AND (i.breakdown->>'period_end')::timestamptz=p_end
      AND EXISTS(SELECT FROM public.accounting_invoice_deliveries d WHERE d.invoice_id=i.id);
    IF FOUND THEN
      IF (document.breakdown->>'rake_generated')::numeric IS DISTINCT FROM item.fees OR
         (document.breakdown->>'rakeback_due')::numeric IS DISTINCT FROM item.paid THEN
        RAISE EXCEPTION 'weekly_club_prior_statement_disagrees_with_paid_receipt'; END IF;
      invoice:=document.id; wl:=(document.breakdown->>'players_won')::numeric; wl_source:='closed_book';
    ELSE
      SELECT (club->>'cash_player_pnl')::numeric+(club->>'tournament_player_pnl')::numeric INTO wl
      FROM jsonb_array_elements(qualified_report->'clubs') club WHERE club->>'club_id'=item.id::text;
      wl_source:='closed_book';
      IF wl IS NULL THEN
        -- Same posted Club Data facts and adjustments as ca_club_acct_fact_ct.
        -- Keep the union dimension for clubs that changed unions. No hand replay.
        SELECT sum(v.result) INTO wl FROM (
          SELECT f.result FROM public.ca_club_acct_fact f WHERE f.club_id=item.id AND f.union_id=p_union
            AND f.acct_day BETWEEN public.fn_ca_accounting_day(week_start) AND public.fn_ca_accounting_day(p_end-interval '1 microsecond')
          UNION ALL
          SELECT j.result FROM public.ca_club_acct_fact_journal j WHERE j.club_id=item.id AND j.union_id=p_union
            AND j.acct_day BETWEEN public.fn_ca_accounting_day(week_start) AND public.fn_ca_accounting_day(p_end-interval '1 microsecond')
        ) v;
        wl_source:=CASE WHEN wl IS NOT NULL THEN 'posted_club_data' END;
      END IF;
      IF item.paid>0 THEN
        SELECT i.id INTO STRICT invoice FROM public.settlement_invoices i JOIN public.chip_ledger l ON l.id=i.source_ledger_id
        WHERE i.club_id=item.id AND i.invoice_type='union_to_club' AND i.from_entity_id=p_union::text
          AND i.to_entity_id=item.id::text AND i.status='paid' AND i.chips_transferred AND i.net_amount=item.paid
          AND i.breakdown->>'settlement_id'=settlement.id::text AND (i.breakdown->>'rake_basis')::numeric=item.fees
          AND l.from_type='union_wallet' AND l.from_entity_id=p_union AND l.to_type='club_treasury'
          AND l.to_entity_id=item.id AND l.status='posted' AND l.amount=item.paid;
      ELSE
        INSERT INTO public.settlement_periods(club_id,union_id,period_number,year,start_at,end_at,status)
        VALUES(item.id,p_union,extract(week FROM week_start),extract(isoyear FROM week_start),week_start,p_end,'processing')
        ON CONFLICT(club_id,union_id,start_at,end_at) DO NOTHING;
        SELECT id INTO STRICT period FROM public.settlement_periods WHERE club_id=item.id AND union_id=p_union
          AND start_at=week_start AND end_at=p_end;
        INSERT INTO public.settlement_invoices(club_id,period_id,invoice_type,from_entity_type,from_entity_id,
          to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,chips_transferred)
        VALUES(item.id,period,'union_to_club','union',p_union::text,'club',item.id::text,0,0,0,
          jsonb_build_object('category','weekly_zero_rakeback','settlement_id',settlement.id,'rake_basis',item.fees,
            'period_start',week_start,'period_end',p_end),'paid',false) RETURNING id INTO invoice;
      END IF;
    END IF;
    INSERT INTO smarter_private.weekly_club_rakeback_documents
    VALUES(p_union,p_end,item.id,settlement.id,invoice,recipients,item.fees,item.paid,wl,wl_source);
    IF document.id IS NULL THEN
      result:=public.fn_deliver_accounting_invoice(invoice);
      IF (result->>'new_deliveries')::int>0 THEN delivered:=delivered+1; END IF;
    END IF;
    SELECT array_agg(d.recipient_id ORDER BY d.recipient_id) INTO actual
    FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id
    WHERE d.invoice_id=invoice AND m.message_type='invoice' AND m.media_metadata->>'invoice_id'=invoice::text;
    IF actual IS DISTINCT FROM recipients THEN RAISE EXCEPTION 'weekly_club_rakeback_delivery_incomplete'; END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true,'clubs',clubs,'newly_delivered',delivered);
END
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_club_rakeback_statements(uuid,timestamptz),
  smarter_private.weekly_zero_balance_document(public.settlement_invoices) FROM PUBLIC,anon,authenticated,service_role;

-- Patch the installed document owner at the exact delivery decisions. Its existing
-- invoice id, private conversation, notifications, audience and deduplication are retained.
DO $patch$
DECLARE sig regprocedure; definition text; old text; revised text; change record;
BEGIN
 FOR change IN SELECT * FROM (VALUES
 ('public.fn_deliver_accounting_invoice(uuid)',
  'DECLARE inv public.settlement_invoices%ROWTYPE;',
  'DECLARE weekly_doc smarter_private.weekly_club_rakeback_documents%ROWTYPE; inv public.settlement_invoices%ROWTYPE;'),
 ('public.fn_deliver_accounting_invoice(uuid)',
  ' IF NOT (coalesce(current_setting(''app.deliver_weekly_credit_invoice''',
  $part$ SELECT * INTO weekly_doc FROM smarter_private.weekly_club_rakeback_documents d WHERE d.invoice_id=inv.id;
 IF smarter_private.weekly_zero_balance_document(inv) THEN
   RETURN jsonb_build_object('success',true,'invoice_id',inv.id,'delivered',0,'new_deliveries',0,'delivery','record_only');
 END IF;
 IF weekly_doc.invoice_id IS NULL AND NOT (coalesce(current_setting('app.deliver_weekly_credit_invoice'$part$),
 ('public.fn_deliver_accounting_invoice(uuid)',
  ' FOREACH person IN ARRAY users LOOP',
  $part$ IF weekly_doc.invoice_id IS NOT NULL AND inv.invoice_type='union_to_club' THEN
   users:=weekly_doc.audience;
   body:='Weekly Club Rakeback '||inv.invoice_number||E'\n'||issuer_name||' to '||recipient_name
     ||E'\nWeek of '||to_char((inv.breakdown->>'period_start')::timestamptz AT TIME ZONE 'America/Los_Angeles','Mon DD, YYYY')
     ||' through '||to_char((weekly_doc.period_end-interval '1 microsecond') AT TIME ZONE 'America/Los_Angeles','Mon DD, YYYY')
     ||E'\nCertified fees: '||smarter_private.union_statement_figure(weekly_doc.fees)
     ||E'\nClub rakeback paid: '||smarter_private.union_statement_figure(weekly_doc.rakeback)
     ||E'\nUnion share: '||smarter_private.union_statement_figure(weekly_doc.fees-weekly_doc.rakeback)
     ||CASE weekly_doc.player_net_source WHEN 'closed_book' THEN E'\nCertified player W/L: '||smarter_private.union_statement_figure(weekly_doc.player_net)
       WHEN 'posted_club_data' THEN E'\nClub Data player W/L (posted, closing balance pending): '||smarter_private.union_statement_figure(weekly_doc.player_net)
       ELSE E'\nClub Data player W/L: no result recorded' END;
   meta:=meta||jsonb_build_object('weekly_rakeback',jsonb_strip_nulls(jsonb_build_object(
     'settlement_id',weekly_doc.settlement_id,'fees',weekly_doc.fees,'club_share',weekly_doc.rakeback,
     'union_share',weekly_doc.fees-weekly_doc.rakeback,'player_net',weekly_doc.player_net,'player_net_source',weekly_doc.player_net_source)));
 ELSIF inv.invoice_type='union_weekly_squareup' AND EXISTS(
   SELECT FROM smarter_private.weekly_club_rakeback_documents d
   WHERE d.union_id=(inv.breakdown->>'union_id')::uuid AND d.club_id=inv.club_id
     AND d.period_end=(inv.breakdown->>'period_end')::timestamptz AND d.invoice_id<>inv.id) THEN
   -- Reuse the billing owner's original parties, due date, credits and unpaid
   -- balance. The rakeback details were already sent in their own receipt.
   body:=split_part(body,E'\n\nRake Generated:',1)
     ||E'\nECO: '||smarter_private.union_statement_amount(inv.breakdown->'eco_amount')
     ||E'\nPresettlements: '||smarter_private.union_statement_amount(inv.breakdown->'presettled')
     ||E'\nRemaining Unpaid Balance: '||split_part(body,E'\nRemaining Unpaid Balance: ',2);
 END IF;
 FOREACH person IN ARRAY users LOOP$part$),
 ('public.fn_get_user_conversations(uuid,uuid)',
  $part$AND COALESCE(si.invoice_type, '') NOT IN ('cashier_cashout', 'union_weekly_squareup', 'union_weekly_credit_note')$part$,
  $part$AND COALESCE(si.invoice_type, '') NOT IN ('cashier_cashout', 'union_weekly_squareup', 'union_weekly_credit_note')
              AND NOT EXISTS(SELECT FROM smarter_private.weekly_club_rakeback_documents wd
                WHERE wd.invoice_id=si.id AND d.recipient_id=p_user_id AND p_user_id=ANY(wd.audience))
              AND NOT EXISTS(SELECT FROM public.credit_invoices ci JOIN public.agents a ON a.id=ci.agent_id
                JOIN public.agent_credit_weekly_basis b ON b.agent_id=ci.agent_id AND b.club_id=a.club_id
                  AND b.period_start=ci.period_start AND b.period_end=ci.period_end AND b.credit_line>0
                WHERE ci.id=si.source_credit_invoice_id AND si.club_id=a.club_id
                  AND si.from_entity_type='club' AND si.from_entity_id=a.club_id::text AND si.to_entity_type='agent'
                  AND si.to_entity_id=a.user_id::text AND si.breakdown->>'kind'='credit_invoice'
                  AND d.recipient_id=p_user_id AND p_user_id=a.user_id)$part$),
 ('smarter_private.weekly_payout_owner_milestones(timestamptz,timestamptz,uuid)',
  $part$SELECT count(*) AS n, count(*) FILTER (WHERE x.delivered) AS d INTO st
    FROM smarter_private.weekly_union_club_statements(p_period_end,p_union) x;$part$,
  $part$SELECT count(*) AS n,count(*) AS d INTO st FROM smarter_private.weekly_club_rakeback_documents
    WHERE period_end=p_period_end AND union_id=p_union;
  IF st.n=0 THEN
    SELECT count(*) AS n,count(*) FILTER (WHERE x.delivered) AS d INTO st
    FROM smarter_private.weekly_union_club_statements(p_period_end,p_union) x;
  END IF;$part$),
 ('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)',
  '  PERFORM public.fn_require_union_pnl_evidence(p_union_id,v_from,v_to);',
  $part$  PERFORM pg_advisory_xact_lock(hashtextextended('weekly-club-rakeback-documents:'||p_union_id::text||':'||extract(epoch FROM v_to)::text,0));
  PERFORM public.fn_require_union_pnl_evidence(p_union_id,v_from,v_to);$part$),
 ('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)',
  'WHERE COALESCE(settlement_invoices.message_sent, false) = false AND settlement_invoices.status',
  'WHERE COALESCE(settlement_invoices.message_sent, false) = false AND NOT smarter_private.weekly_zero_balance_document(settlement_invoices) AND settlement_invoices.status'),
 ('public.fn_process_weekly_accounting_scope(uuid,uuid)','AND si.message_sent=true AND si.status',
  'AND (si.message_sent=true OR smarter_private.weekly_zero_balance_document(si)) AND si.status'),
 ('public.fn_union_settlement_cascade(uuid,timestamptz,timestamptz)','AND si.message_sent=true AND si.status',
  'AND (si.message_sent=true OR smarter_private.weekly_zero_balance_document(si)) AND si.status'),
 ('public.fn_ca_governance_eco_proven(jsonb)','AND i.message_sent=true AND i.status',
  'AND (i.message_sent=true OR smarter_private.weekly_zero_balance_document(i)) AND i.status')
 ) AS c(signature,anchor,replacement) LOOP
   sig:=change.signature::regprocedure; definition:=pg_get_functiondef(sig);
   old:=change.anchor; revised:=change.replacement;
   IF strpos(definition,old)=0 OR strpos(substr(definition,strpos(definition,old)+length(old)),old)>0 THEN
     RAISE EXCEPTION 'weekly_club_rakeback_document_owner_changed: %',sig;
   END IF;
   EXECUTE replace(definition,old,revised);
 END LOOP;
 -- The payout eligibility mirror pins the exact authoritative weekly accounting body.
 -- Keep the same fail-closed check across the zero-due document change.
 sig:='smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure;
 definition:=pg_get_functiondef(sig);
 IF md5(definition)<>'c848defe5268e362649d60c4c1b3b381'
    OR md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))<>'a98e1f9462ebc956279eef816bee3bc6' THEN
   RAISE EXCEPTION 'weekly_club_rakeback_payout_eligibility_owner_changed';
 END IF;
 EXECUTE replace(definition,'822ba13945933790fa0cea0e23076999','a98e1f9462ebc956279eef816bee3bc6');
 IF md5(pg_get_functiondef(sig))<>'e51624f516c2e9ef11ce70ceac462e77' THEN
   RAISE EXCEPTION 'weekly_club_rakeback_payout_eligibility_guard_missing';
 END IF;
END $patch$;
COMMIT;
