-- 20261115151821_union_statements_are_delivered_and_owe_what_they_say.sql
--
-- Version reserved by scripts/reserve-migration-version.sh.
--
-- AUDIT FINDINGS G3, G4, G5 (2026-11-15), Midway Union weekly statements.
--
-- G3 - "DELIVERED" THAT WAS NEVER DELIVERED. MIDWAY-2026-000020..041 (22
--   square-ups, weeks of 2026-10-05 through 2026-11-02) all read
--   message_sent = true and the Union Statements board counted them
--   "Delivered", yet accounting_invoice_deliveries holds no row for any of
--   them. Until 2026-11-14 fn_deliver_accounting_invoice recorded every
--   non-cashout document "in transaction history only and marked delivered so
--   the weekly close is satisfied"; 20261114163249 sent new union statements
--   through the Messenger but explicitly sent nothing already issued. The
--   flag also guards the square-up upsert against restating an issued figure,
--   so it cannot simply be turned off.
--   FIX: (a) a union square-up or credit note is marked sent only when a
--   delivery row exists for it - the Messenger path no longer sets the flag
--   on zero recipients; (b) the board reads delivery from
--   accounting_invoice_deliveries, so a record-only row (the union's own
--   house statement, a statement to itself) reads "Not Delivered" instead of
--   claiming a delivery that never happened; (c) the 17 club statements in
--   MIDWAY-2026-000020..041 are delivered once now through the same idempotent
--   function (it skips any recipient already delivered). The five union house
--   rows (000021, 025, 030, 035, 040) stay record-only by design.
--   Rolled-back probe (one DO block ending in RAISE): every club statement
--   delivered to 1 or 2 recipients, none failed.
--
-- G4 - PAID IGNORED CREDIT NOTES. ca_union_set_statement_paid took the amount
--   owed as abs(net_amount), so a statement reduced by a credit note could
--   only be marked paid by paying the uncredited figure. The board already
--   subtracts credits (fn_union_invoice_outstanding). FIX: owed = abs(net)
--   minus every credit note that adjusts the statement and is not cancelled,
--   never below zero.
--
-- G5 - DUE BEFORE ISSUED. fn_union_issue_weekly_invoices set due_at = week end
--   + 3 days whatever the issue time. The week of 2026-10-26 was issued
--   2026-11-10 16:05 UTC due 2026-11-05 (five statements), the week of
--   2026-10-19 issued 2026-11-08 22:45 due 2026-10-29 (five), so ten
--   statements were overdue the moment they existed. FIX: due_at =
--   greatest(week end, issue time) + 3 days. The issuance lag itself was the
--   close's 240 s tick budget on job 272; 20261114163249 already runs the
--   close every two minutes on payout day (cron 'weekly-union-books'), which
--   first applies on the Monday 2026-11-16 close.
--
-- Issued figures are never edited: this migration writes only Messenger rows,
-- notifications and accounting_invoice_deliveries (through the deliverer).
--
-- @live-proof: position('union statement is marked sent only when delivered' IN pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))>0 AND position('accounting_invoice_deliveries d WHERE d.invoice_id = i.id' IN pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure))>0 AND position('union_weekly_credit_note' IN pg_get_functiondef('public.ca_union_set_statement_paid(uuid,boolean,numeric,text)'::regprocedure))>0 AND position('GREATEST(v_to, now())' IN pg_get_functiondef('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)'::regprocedure))>0 AND NOT EXISTS (SELECT 1 FROM public.settlement_invoices s WHERE s.invoice_number BETWEEN 'MIDWAY-2026-000020' AND 'MIDWAY-2026-000041' AND s.club_id <> 'fade0000-0000-0000-0000-000000000001'::uuid AND NOT EXISTS (SELECT 1 FROM public.accounting_invoice_deliveries d WHERE d.invoice_id = s.id))

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $patch$
DECLARE
  r record; f record; d text; m jsonb; m2 jsonb;
BEGIN
  -- Every body is the one this file was qualified against.
  FOR f IN SELECT * FROM (VALUES
      ('public.fn_deliver_accounting_invoice(uuid)', '458ff407d31dcc676a8541d3b223396f'),
      ('public.ca_union_statement_board(uuid,date,integer)', '2f9f7d0660bd71748536ed641cb214da'),
      ('public.ca_union_set_statement_paid(uuid,boolean,numeric,text)', 'f4e452991f7a3618c83267a48ad7bd55'),
      ('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)', 'd80cbc7f7ff6e9fe5c165e78a39f9dad')
    ) x(sig, hash) LOOP
    IF md5(pg_get_functiondef(f.sig::regprocedure)) IS DISTINCT FROM f.hash THEN
      RAISE EXCEPTION 'UNION_STATEMENTS_PREIMAGE_CHANGED: %', f.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOR f IN SELECT DISTINCT sig FROM (VALUES
      ('public.fn_deliver_accounting_invoice(uuid)'),
      ('public.ca_union_statement_board(uuid,date,integer)'),
      ('public.ca_union_set_statement_paid(uuid,boolean,numeric,text)'),
      ('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)')) x(sig) LOOP
    d := pg_get_functiondef(f.sig::regprocedure);
    FOR r IN SELECT * FROM (VALUES
      -- G3a: a union statement is sent when a delivery row exists, not before.
      ('public.fn_deliver_accounting_invoice(uuid)',
       E' UPDATE public.settlement_invoices SET message_sent=true,message_sent_at=COALESCE(message_sent_at,now()) WHERE id=inv.id;\n RETURN jsonb_build_object(''success'',true,''invoice_id'',inv.id,''delivered'',n,',
       E' -- A union statement is marked sent only when delivered (2026-11-15, audit G3):\n'
       || E' -- with no recipient reached it stays unsent, never "Delivered" to nobody.\n'
       || E' UPDATE public.settlement_invoices SET message_sent=true,message_sent_at=COALESCE(message_sent_at,now()) WHERE id=inv.id\n'
       || E'   AND (n>0 OR inv.invoice_type NOT IN(''union_weekly_squareup'',''union_weekly_credit_note''));\n'
       || E' RETURN jsonb_build_object(''success'',true,''invoice_id'',inv.id,''delivered'',n,'),
      -- G3b: the board reads delivery from the delivery record.
      ('public.ca_union_statement_board(uuid,date,integer)',
       'COALESCE(i.message_sent, false) AS message_sent,',
       'EXISTS (SELECT 1 FROM accounting_invoice_deliveries d WHERE d.invoice_id = i.id) AS message_sent,'),
      ('public.ca_union_statement_board(uuid,date,integer)',
       'count(*) FILTER (WHERE COALESCE(s.message_sent, false))               AS delivered',
       'count(*) FILTER (WHERE EXISTS (SELECT 1 FROM accounting_invoice_deliveries d WHERE d.invoice_id = s.id)) AS delivered'),
      -- G4: what is owed is the statement less its credit notes.
      ('public.ca_union_set_statement_paid(uuid,boolean,numeric,text)',
       'v_owed     := abs(COALESCE(v_inv.net_amount, 0));',
       E'-- ... less every credit note that adjusts it and is not cancelled\n'
       || E'  -- (2026-11-15, audit G4), never below zero.\n'
       || E'  v_owed     := GREATEST(round(abs(COALESCE(v_inv.net_amount, 0)) - COALESCE((\n'
       || E'                  SELECT SUM(cn.net_amount) FROM settlement_invoices cn\n'
       || E'                   WHERE cn.adjusts_invoice_id = v_inv.id\n'
       || E'                     AND cn.invoice_type = ''union_weekly_credit_note''\n'
       || E'                     AND cn.status IS DISTINCT FROM ''cancelled''), 0), 2), 0);'),
      -- G5: a statement is never due before it exists.
      ('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)',
       E'v_due := v_to + interval ''3 days'';',
       E'-- Never due before it is issued (2026-11-15, audit G5).\n'
       || E'  v_due := GREATEST(v_to, now()) + interval ''3 days'';')
    ) p(sig, anchor, replacement) WHERE p.sig = f.sig LOOP
      IF (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor) <> 1 THEN
        RAISE EXCEPTION 'UNION_STATEMENTS_ANCHOR: %', f.sig USING ERRCODE = '55000';
      END IF;
      d := replace(d, r.anchor, r.replacement);
    END LOOP;
    SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
      INTO m FROM pg_proc WHERE oid = f.sig::regprocedure;
    EXECUTE d;
    SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
      INTO m2 FROM pg_proc WHERE oid = f.sig::regprocedure;
    IF m2 IS DISTINCT FROM m OR pg_get_functiondef(f.sig::regprocedure) <> d THEN
      RAISE EXCEPTION 'UNION_STATEMENTS_POSTIMAGE: % %', f.sig, md5(pg_get_functiondef(f.sig::regprocedure)) USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$patch$;

-- G3c: the club statements that were marked delivered are delivered, once.
DO $deliver$
DECLARE r record; v jsonb; n int := 0;
BEGIN
  FOR r IN SELECT s.id, s.invoice_number FROM public.settlement_invoices s
            WHERE s.invoice_number BETWEEN 'MIDWAY-2026-000020' AND 'MIDWAY-2026-000041'
              AND s.invoice_type = 'union_weekly_squareup'
              AND s.breakdown->>'union_id' = 'fade0000-0000-0000-0000-000000000001'
              AND s.club_id <> 'fade0000-0000-0000-0000-000000000001'::uuid
            ORDER BY s.invoice_number LOOP
    v := public.fn_deliver_accounting_invoice(r.id);
    IF COALESCE((v->>'delivered')::int, 0) < 1 THEN
      RAISE EXCEPTION 'UNION_STATEMENT_NOT_DELIVERED: % %', r.invoice_number, v USING ERRCODE = '55000';
    END IF;
    n := n + 1;
  END LOOP;
  IF n <> 17 THEN
    RAISE EXCEPTION 'UNION_STATEMENTS_DELIVERY_SET_CHANGED: % club statements, expected 17', n USING ERRCODE = '55000';
  END IF;
END
$deliver$;

COMMIT;
