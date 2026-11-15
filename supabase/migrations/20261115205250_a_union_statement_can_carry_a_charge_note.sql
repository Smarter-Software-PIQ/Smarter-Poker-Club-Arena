-- 20261115205250_a_union_statement_can_carry_a_charge_note
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 20:52:50 UTC.
--
-- WHAT WAS MISSING. A union could correct an issued weekly statement only
-- downward: fn_union_issue_credit_note writes a numbered document with
-- adjusts_invoice_id that REDUCES what is owed, the original unchanged. There
-- was no document that ADDS to an issued statement, so the audit's D1
-- settlement (20261115151824) recorded one correction it could not make:
-- MIDWAY-2026-000034, KINGS CLUB, week of 2026-10-26, was billed 43.86 too
-- little ("The union has no debit-note document; a credit note can only
-- reduce").
--
-- WHAT THIS ADDS (section 1), mirroring the credit note exactly:
--   * invoice type 'union_weekly_debit_note' ("Charge Note" on screen), added
--     to settlement_invoices_invoice_type_check;
--   * public.fn_union_issue_debit_note(p_invoice_id, p_amount, p_reason,
--     p_notify): the credit note's caller rule (union owner, union admin,
--     platform admin, or no signed-in caller = server), amount > 0, a reason,
--     only against a union_weekly_squareup carrying a union_id, numbered from
--     the same union_invoice_counters (fn_next_invoice_number), delivered by
--     the same on-insert trigger. A charge note keeps the statement's own
--     direction and is refused unless the club owes the union. Because it adds
--     money, an identical second note (same statement, amount and reason, not
--     cancelled) is refused. Like the credit note it does not refuse a paid
--     statement (the credit note does not either); marking paid then owes the
--     difference. Same grants as the credit note.
--   * every reader that subtracts credit notes now also adds charge notes,
--     cancelled notes counted by neither: fn_union_invoice_outstanding (which
--     the board, the aging/dunning run and the stop-loss read),
--     ca_union_set_statement_paid, ca_union_statement_board (also returns
--     charge_notes beside credit_notes), smarter_private.union_weekly_invoice_
--     body (a Charge Note body; a statement with charges says "After Charge"
--     and "Charged By"), and fn_union_issue_credit_note (what is left to
--     credit includes charges);
--   * every list of union statement types learns the new one: the deliverer
--     fn_deliver_accounting_invoice (5 places), fn_get_user_conversations,
--     fn_union_send_club_message ('union_debit_note' / debit_note_id) and
--     fn_union_club_statement_of_account (entry_type 'debit_note', "Charge note
--     against ...", same sign as the statement).
--   * Mark Paid works on a delivered union statement again: the issued-
--     document guard (fn_accounting_document_immutable) froze the whole
--     breakdown, and ca_union_set_statement_paid writes the payment into it,
--     so every delivered union statement refused Mark Paid
--     (issued_accounting_invoice_is_immutable). For union_weekly_squareup /
--     _credit_note / _debit_note only, the guard ignores the four payment
--     keys (paid_total, paid_at, paid_by, payments); everything else is
--     frozen exactly as before.
--   Every body is patched from its installed source under an md5 guard
--   (captured in scripts/ci/fixtures/union-charge-notes/production-preimages
--   .json); every anchor must occur the stated number of times; owner, ACL,
--   SECURITY DEFINER, config and volatility must be unchanged afterwards. With
--   no charge note on a statement every reader returns exactly what it
--   returned before (no credit note on production is cancelled: 13 notes,
--   statuses generated/paid).
--
-- THE ONE CHARGE NOTE (section 2), the D1 correction 20261115151824 could not
-- make. Re-derived read-only from production on 2026-11-15 (Bad Beat Jackpot
-- wallet shares paid from Midway pools 2026-10-26 07:00Z..2026-11-02 08:00Z,
-- wallet club from the posted chip_ledger leg, earning club from the hand's
-- rake_attributions): KINGS's statement carried 806.26 of shares played
-- through The Felt Society, and 367.70 of KINGS's own shares (106.25 on a
-- Felt wallet, 261.45 on the union house wallet) were counted elsewhere: net
-- 438.56 too much in player wins on KINGS. KINGS cash ECO base 937,483.89 ->
-- 937,922.45; cash ECO round(-0.10 * base, 2) -93,748.39 -> -93,792.25; KINGS
-- was billed 43.86 too little. The file re-derives 438.56 and 43.86 from the
-- rows at install and aborts if either moved. Owed on 000034 becomes
-- 110,114.30 + 43.86 = 110,158.16; the original statement is unchanged.
-- Idempotent: a statement already carrying this charge note is skipped; any
-- other charge note on it aborts.
--
-- TIMING: not to be installed before 2026-11-16 18:00Z (the Monday payout
-- and statement issue at 10:00Z changes statement readers' inputs).
--
-- @live-proof: position('union_weekly_debit_note' IN (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'settlement_invoices_invoice_type_check' AND c.conrelid = 'public.settlement_invoices'::regclass))>0 AND to_regprocedure('public.fn_union_issue_debit_note(uuid,numeric,text,boolean)') IS NOT NULL AND position('union_weekly_debit_note' IN pg_get_functiondef('public.fn_union_invoice_outstanding(uuid)'::regprocedure))>0 AND position('union_weekly_debit_note' IN pg_get_functiondef('public.ca_union_set_statement_paid(uuid,boolean,numeric,text)'::regprocedure))>0 AND position('charge_notes' IN pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure))>0 AND position('union_weekly_debit_note' IN pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))>0 AND position('ARRAY[''paid_total'',''paid_at'',''paid_by'',''payments'']' IN pg_get_functiondef('public.fn_accounting_document_immutable()'::regprocedure))>0 AND (SELECT count(*) FROM public.settlement_invoices dn JOIN public.settlement_invoices s ON s.id = dn.adjusts_invoice_id WHERE dn.invoice_type = 'union_weekly_debit_note' AND s.invoice_number = 'MIDWAY-2026-000034' AND dn.net_amount = 43.86 AND dn.status IS DISTINCT FROM 'cancelled') = 1 AND public.fn_union_invoice_outstanding((SELECT s.id FROM public.settlement_invoices s WHERE s.invoice_number = 'MIDWAY-2026-000034')) = 110158.16

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ==== SECTION 1: THE CAPABILITY ====

DO $type$
BEGIN
  IF (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c
       WHERE c.conname = 'settlement_invoices_invoice_type_check'
         AND c.conrelid = 'public.settlement_invoices'::regclass)
     IS DISTINCT FROM 'f47e292808a4ab9595d880353d18e21b' THEN
    RAISE EXCEPTION 'CHARGE_NOTE_TYPE_CHECK_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$type$;
ALTER TABLE public.settlement_invoices DROP CONSTRAINT settlement_invoices_invoice_type_check;
ALTER TABLE public.settlement_invoices ADD CONSTRAINT settlement_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY['union_to_club'::text, 'club_to_agent'::text, 'agent_to_subagent'::text,
    'agent_to_player'::text, 'union_club_pnl'::text, 'club_to_union'::text, 'union_weekly_squareup'::text,
    'union_weekly_credit_note'::text, 'union_weekly_debit_note'::text, 'transaction_receipt'::text,
    'club_weekly_accounting'::text, 'cashier_cashout'::text, 'accounting_correction'::text,
    'credit_limit_change'::text])) NOT VALID;
ALTER TABLE public.settlement_invoices VALIDATE CONSTRAINT settlement_invoices_invoice_type_check;

-- Patch an installed body: md5 guard, each anchor exactly the stated number
-- of times, and the same owner, ACL, security, config and volatility after.
CREATE FUNCTION pg_temp.cn_patch(p_fn regprocedure, p_md5 text, p_edits text[])
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i int;
  m jsonb;
  m2 jsonb;
BEGIN
  IF md5(d) IS DISTINCT FROM p_md5 THEN
    RAISE EXCEPTION 'CHARGE_NOTE_PREIMAGE_CHANGED: % %', p_fn, md5(d) USING ERRCODE = '55000';
  END IF;
  FOR i IN 1 .. array_length(p_edits, 1) BY 3 LOOP
    IF (length(d) - length(replace(d, p_edits[i], ''))) / length(p_edits[i]) <> p_edits[i + 2]::int THEN
      RAISE EXCEPTION 'CHARGE_NOTE_ANCHOR in %: %', p_fn, p_edits[i] USING ERRCODE = '55000';
    END IF;
    d := replace(d, p_edits[i], p_edits[i + 1]);
  END LOOP;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = p_fn;
  EXECUTE d;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = p_fn;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(p_fn) <> d THEN
    RAISE EXCEPTION 'CHARGE_NOTE_POSTIMAGE: %', p_fn USING ERRCODE = '55000';
  END IF;
END
$patch$;

-- What is owed on a statement: less credit notes, plus charge notes.
SELECT pg_temp.cn_patch('public.fn_union_invoice_outstanding(uuid)'::regprocedure,
  'a3faa24ccb417c0e8a295de75634ea69', ARRAY[
$a$              AND cn.invoice_type = 'union_weekly_credit_note'), 0), 2)$a$,
$a$              AND cn.invoice_type = 'union_weekly_credit_note'
              AND cn.status IS DISTINCT FROM 'cancelled'), 0)
         -- plus every charge note (debit note, 2026-11-15), cancelled ones not counted
         + COALESCE((
           SELECT SUM(dn.net_amount) FROM settlement_invoices dn
            WHERE dn.adjusts_invoice_id = si.id
              AND dn.invoice_type = 'union_weekly_debit_note'
              AND dn.status IS DISTINCT FROM 'cancelled'), 0), 2)$a$, '1']);

SELECT pg_temp.cn_patch('public.ca_union_set_statement_paid(uuid,boolean,numeric,text)'::regprocedure,
  '6757f25eb339e15002c8cf378f181c8e', ARRAY[
$a$  -- (2026-11-15, audit G4), never below zero.$a$,
$a$  -- (2026-11-15, audit G4), plus every charge note (debit note) that
  -- adjusts it and is not cancelled (2026-11-15), never below zero.$a$, '1',
$a$                     AND cn.status IS DISTINCT FROM 'cancelled'), 0), 2), 0);$a$,
$a$                     AND cn.status IS DISTINCT FROM 'cancelled'), 0)
                + COALESCE((
                  SELECT SUM(dn.net_amount) FROM settlement_invoices dn
                   WHERE dn.adjusts_invoice_id = v_inv.id
                     AND dn.invoice_type = 'union_weekly_debit_note'
                     AND dn.status IS DISTINCT FROM 'cancelled'), 0), 2), 0);$a$, '1']);

SELECT pg_temp.cn_patch('public.ca_union_statement_board(uuid,date,integer)'::regprocedure,
  '38e0bd2e7d3eb8b7dbfa79d2140cb3d7', ARRAY[
$a$               AND cn.invoice_type = 'union_weekly_credit_note') AS credit_notes,$a$,
$a$               AND cn.invoice_type = 'union_weekly_credit_note'
               AND cn.status IS DISTINCT FROM 'cancelled') AS credit_notes,
           -- Charge notes (debit notes, 2026-11-15) add to what is owed.
           (SELECT jsonb_agg(jsonb_build_object('invoice_number', dn.invoice_number,
                                                'amount', round(dn.net_amount, 2))
                             ORDER BY dn.created_at, dn.invoice_number)
              FROM settlement_invoices dn
             WHERE dn.adjusts_invoice_id = i.id
               AND dn.invoice_type = 'union_weekly_debit_note'
               AND dn.status IS DISTINCT FROM 'cancelled') AS charge_notes,$a$, '1',
$a$               'credit_notes', b.credit_notes,$a$,
$a$               'credit_notes', b.credit_notes,
               'charge_notes', b.charge_notes,$a$, '1']);

SELECT pg_temp.cn_patch('smarter_private.union_weekly_invoice_body(uuid)'::regprocedure,
  'a3f7005d4c4a666511dfb7a9b7faa951', ARRAY[
$a$  v_paid numeric;
BEGIN$a$,
$a$  v_paid numeric;
  v_charges text;
  v_charged numeric;
BEGIN$a$, '1',
$a$inv.invoice_type NOT IN ('union_weekly_squareup', 'union_weekly_credit_note') THEN$a$,
$a$inv.invoice_type NOT IN ('union_weekly_squareup', 'union_weekly_credit_note', 'union_weekly_debit_note') THEN$a$, '1',
$a$      || CASE WHEN b ? 'reason' THEN E'\nReason: ' || (b->>'reason') ELSE '' END;
  END IF;
$a$,
$a$      || CASE WHEN b ? 'reason' THEN E'\nReason: ' || (b->>'reason') ELSE '' END;
  END IF;

  -- A charge note (debit note, 2026-11-15) adds to the original invoice.
  IF inv.invoice_type = 'union_weekly_debit_note' THEN
    SELECT o.invoice_number INTO v_original FROM public.settlement_invoices o
     WHERE o.id = CASE WHEN pg_input_is_valid(b->>'original_invoice_id', 'uuid')
                       THEN (b->>'original_invoice_id')::uuid END;
    RETURN v_union_name || ' Charge Note ' || COALESCE(inv.invoice_number, '')
      || E'\nAgainst Invoice: ' || COALESCE(v_original, b->>'debit_note_for', 'Unavailable')
      || E'\nWeek: ' || smarter_private.union_statement_week(v_start, v_end)
      || E'\nThe Week Includes Its Start And Excludes Its End.'
      || E'\nIssued By: ' || v_union_name
      || E'\nIssued To: ' || v_club_name
      || CASE WHEN v_house THEN ' (The Union''s Own House Club)' ELSE '' END
      || E'\nCharge: ' || v_payer || ' Pays ' || v_payee || ' '
      || smarter_private.union_statement_figure(abs(inv.net_amount)) || ' Chips More'
      || E'\nA Charge Note Adds To The Original Invoice. No Chips Move.'
      || E'\nStatus: ' || initcap(inv.status)
      || CASE WHEN b ? 'reason' THEN E'\nReason: ' || (b->>'reason') ELSE '' END;
  END IF;
$a$, '1',
$a$   WHERE cn.adjusts_invoice_id = inv.id AND cn.invoice_type = 'union_weekly_credit_note';
  v_remaining := round(abs(inv.net_amount) - COALESCE(v_credited, 0), 2);$a$,
$a$   WHERE cn.adjusts_invoice_id = inv.id AND cn.invoice_type = 'union_weekly_credit_note'
     AND cn.status IS DISTINCT FROM 'cancelled';
  -- ... and owes more for every charge note (debit note, 2026-11-15).
  SELECT string_agg(dn.invoice_number || ' (' || smarter_private.union_statement_figure(dn.net_amount) || ')',
                    ', ' ORDER BY dn.created_at, dn.invoice_number),
         sum(dn.net_amount)
    INTO v_charges, v_charged
    FROM public.settlement_invoices dn
   WHERE dn.adjusts_invoice_id = inv.id AND dn.invoice_type = 'union_weekly_debit_note'
     AND dn.status IS DISTINCT FROM 'cancelled';
  v_remaining := round(abs(inv.net_amount) - COALESCE(v_credited, 0) + COALESCE(v_charged, 0), 2);$a$, '1',
$a$            WHEN v_credits IS NOT NULL
              THEN v_payer || ' Pays ' || v_payee || ' '
                || smarter_private.union_statement_figure(v_remaining) || ' Chips After Credit'$a$,
$a$            WHEN v_credits IS NOT NULL OR v_charges IS NOT NULL
              THEN v_payer || ' Pays ' || v_payee || ' '
                || smarter_private.union_statement_figure(v_remaining) || ' Chips After '
                || concat_ws(' And ', CASE WHEN v_credits IS NOT NULL THEN 'Credit' END,
                                      CASE WHEN v_charges IS NOT NULL THEN 'Charge' END)$a$, '1',
$a$    || CASE WHEN v_credits IS NOT NULL
            THEN E'\nOriginal Amount: ' || smarter_private.union_statement_figure(abs(inv.net_amount))
              || E'\nCredited By: ' || v_credits
            ELSE '' END$a$,
$a$    || CASE WHEN v_credits IS NOT NULL OR v_charges IS NOT NULL
            THEN E'\nOriginal Amount: ' || smarter_private.union_statement_figure(abs(inv.net_amount))
              || COALESCE(E'\nCredited By: ' || v_credits, '')
              || COALESCE(E'\nCharged By: ' || v_charges, '')
            ELSE '' END$a$, '1',
$a$           || CASE WHEN v_credits IS NOT NULL
                   THEN E'\nLess Credit Notes ' || smarter_private.union_statement_figure(COALESCE(v_credited, 0))
$a$,
$a$           || CASE WHEN v_credits IS NOT NULL OR v_charges IS NOT NULL
                   THEN E'\n' || concat_ws(' ',
                          CASE WHEN v_credits IS NOT NULL
                               THEN 'Less Credit Notes ' || smarter_private.union_statement_figure(COALESCE(v_credited, 0)) END,
                          CASE WHEN v_charges IS NOT NULL
                               THEN 'Plus Charge Notes ' || smarter_private.union_statement_figure(COALESCE(v_charged, 0)) END)
$a$, '1']);

SELECT pg_temp.cn_patch('public.fn_union_issue_credit_note(uuid,numeric,text,boolean)'::regprocedure,
  'bc9e552cdbee700f50bc3943208900a1', ARRAY[
$a$  v_remaining := round(v_orig.net_amount - v_credited, 2);$a$,
$a$  -- A charge note (debit note, 2026-11-15) raises what is left to credit.
  v_remaining := round(v_orig.net_amount - v_credited + COALESCE((
                   SELECT SUM(dn.net_amount) FROM settlement_invoices dn
                    WHERE dn.adjusts_invoice_id = p_invoice_id
                      AND dn.invoice_type = 'union_weekly_debit_note'
                      AND dn.status IS DISTINCT FROM 'cancelled'), 0), 2);$a$, '1']);

SELECT pg_temp.cn_patch('public.fn_deliver_accounting_invoice(uuid)'::regprocedure,
  '6b4e9a1bf13238c8e541416515a0870e', ARRAY[
$a$IN('union_weekly_squareup','union_weekly_credit_note')$a$,
$a$IN('union_weekly_squareup','union_weekly_credit_note','union_weekly_debit_note')$a$, '5']);

SELECT pg_temp.cn_patch('public.fn_get_user_conversations(uuid,uuid)'::regprocedure,
  '7f500e49b0a9dd6712a10282f1b53a3f', ARRAY[
$a$'cashier_cashout', 'union_weekly_squareup', 'union_weekly_credit_note')$a$,
$a$'cashier_cashout', 'union_weekly_squareup', 'union_weekly_credit_note', 'union_weekly_debit_note')$a$, '1']);

SELECT pg_temp.cn_patch('public.fn_union_send_club_message(uuid,uuid,text,jsonb,text)'::regprocedure,
  '0aef1e400483eff9434d3a11323682e0', ARRAY[
$a$IN ('union_invoice','union_credit_note')$a$,
$a$IN ('union_invoice','union_credit_note','union_debit_note')$a$, '1',
$a$COALESCE(p_metadata->>'invoice_id',p_metadata->>'credit_note_id')$a$,
$a$COALESCE(p_metadata->>'invoice_id',p_metadata->>'credit_note_id',p_metadata->>'debit_note_id')$a$, '2']);

SELECT pg_temp.cn_patch('public.fn_union_club_statement_of_account(uuid,uuid,timestamptz)'::regprocedure,
  'b44b14d733aba9d2387519aa4709bd5d', ARRAY[
$a$                THEN 'credit_note' ELSE 'statement' END AS entry_type,$a$,
$a$                THEN 'credit_note'
                WHEN si.invoice_type = 'union_weekly_debit_note'
                THEN 'debit_note' ELSE 'statement' END AS entry_type,$a$, '1',
$a$                     || COALESCE(' - ' || (si.breakdown->>'reason'), '')
                ELSE 'Weekly statement '$a$,
$a$                     || COALESCE(' - ' || (si.breakdown->>'reason'), '')
                WHEN si.invoice_type = 'union_weekly_debit_note'
                THEN 'Charge note against ' || COALESCE(si.breakdown->>'debit_note_for', '(unknown)')
                     || COALESCE(' - ' || (si.breakdown->>'reason'), '')
                ELSE 'Weekly statement '$a$, '1',
$a$AND si.invoice_type IN ('union_weekly_squareup', 'union_weekly_credit_note')$a$,
$a$AND si.invoice_type IN ('union_weekly_squareup', 'union_weekly_credit_note', 'union_weekly_debit_note')$a$, '1']);

-- MARK PAID ON A DELIVERED UNION STATEMENT (found 2026-11-15 while
-- rehearsing this file). ca_union_set_statement_paid records the payment in
-- breakdown (paid_total, paid_at, paid_by, payments); the issued-document
-- guard froze the whole breakdown once a statement was delivered, so Mark
-- Paid failed with issued_accounting_invoice_is_immutable on every delivered
-- union statement. For the three union weekly documents only, the guard now
-- compares breakdown without those four payment keys. Every other column,
-- every other breakdown key and every other document type keep the exact
-- current rule; status is already outside the frozen row.
SELECT pg_temp.cn_patch('public.fn_accounting_document_immutable()'::regprocedure,
  '8ec25e2d39e02451020b5ce8e9ec5a1b', ARRAY[
$a$NEW.deductions,NEW.breakdown,$a$,
$a$NEW.deductions,CASE WHEN OLD.invoice_type IN('union_weekly_squareup','union_weekly_credit_note','union_weekly_debit_note')
         THEN NEW.breakdown-ARRAY['paid_total','paid_at','paid_by','payments'] ELSE NEW.breakdown END,$a$, '1',
$a$OLD.deductions,OLD.breakdown,$a$,
$a$OLD.deductions,CASE WHEN OLD.invoice_type IN('union_weekly_squareup','union_weekly_credit_note','union_weekly_debit_note')
         THEN OLD.breakdown-ARRAY['paid_total','paid_at','paid_by','payments'] ELSE OLD.breakdown END,$a$, '1']);

DROP FUNCTION pg_temp.cn_patch(regprocedure, text, text[]);

-- The charge note: the credit note's twin, adding instead of reducing.
CREATE FUNCTION public.fn_union_issue_debit_note(p_invoice_id uuid, p_amount numeric, p_reason text, p_notify boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orig      settlement_invoices%ROWTYPE;
  v_union_id  uuid;
  v_union_name text;
  v_club_name text;
  v_credited  numeric;
  v_charged   numeric;
  v_owed      numeric;
  v_number    text;
  v_new_id    uuid;
  v_msg       jsonb;
BEGIN
  SELECT * INTO v_orig FROM settlement_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  v_union_id := (v_orig.breakdown->>'union_id')::uuid;

  -- WHO IS CALLING, before anything that would describe the document
  -- (the credit note's rule, word for word).
  IF auth.uid() IS NOT NULL
     AND (v_union_id IS NULL
          OR (NOT EXISTS (SELECT 1 FROM unions u WHERE u.id = v_union_id AND u.owner_id = auth.uid())
              AND NOT EXISTS (SELECT 1 FROM union_admins ua WHERE ua.union_id = v_union_id AND ua.user_id = auth.uid())
              AND NOT COALESCE(public.fn_is_platform_admin(), false))) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'a charge note must be for a positive amount in whole cents, got %', p_amount;
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'a charge note must carry a reason';
  END IF;
  IF v_orig.invoice_type <> 'union_weekly_squareup' THEN
    RAISE EXCEPTION 'only a weekly square-up can be charged, this is %', v_orig.invoice_type;
  END IF;
  IF v_union_id IS NULL THEN
    RAISE EXCEPTION 'invoice % carries no union_id in its breakdown', p_invoice_id;
  END IF;
  -- A charge note adds to what the club owes the union; it keeps the
  -- statement's own direction.
  IF v_orig.from_entity_type IS DISTINCT FROM 'club' OR v_orig.to_entity_type IS DISTINCT FROM 'union'
     OR COALESCE(v_orig.net_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'a charge note can only add to a statement the club owes the union, % is % to %',
      COALESCE(v_orig.invoice_number, v_orig.id::text), v_orig.from_entity_type, v_orig.to_entity_type;
  END IF;
  -- Adding money twice is the mistake a credit note's cap cannot catch.
  IF EXISTS (SELECT 1 FROM settlement_invoices dn
              WHERE dn.adjusts_invoice_id = p_invoice_id
                AND dn.invoice_type = 'union_weekly_debit_note'
                AND dn.status IS DISTINCT FROM 'cancelled'
                AND dn.net_amount = p_amount
                AND dn.breakdown->>'reason' = p_reason) THEN
    RAISE EXCEPTION 'charge note already issued: % for % against %',
      p_amount, p_reason, COALESCE(v_orig.invoice_number, v_orig.id::text);
  END IF;

  SELECT COALESCE(SUM(net_amount), 0) INTO v_credited
    FROM settlement_invoices
   WHERE adjusts_invoice_id = p_invoice_id
     AND invoice_type = 'union_weekly_credit_note'
     AND status IS DISTINCT FROM 'cancelled';
  SELECT COALESCE(SUM(net_amount), 0) INTO v_charged
    FROM settlement_invoices
   WHERE adjusts_invoice_id = p_invoice_id
     AND invoice_type = 'union_weekly_debit_note'
     AND status IS DISTINCT FROM 'cancelled';
  v_owed := round(v_orig.net_amount - v_credited + v_charged, 2);

  SELECT u.name INTO v_union_name FROM unions u WHERE u.id = v_union_id;
  SELECT c.name INTO v_club_name FROM clubs c WHERE c.id = v_orig.club_id;
  v_number := public.fn_next_invoice_number(v_union_id, now());

  INSERT INTO settlement_invoices (
    club_id, period_id, invoice_type, invoice_number, adjusts_invoice_id,
    from_entity_type, from_entity_id, to_entity_type, to_entity_id,
    gross_amount, net_amount, deductions, breakdown, status,
    chips_transferred, due_at, notes)
  VALUES (
    v_orig.club_id, v_orig.period_id, 'union_weekly_debit_note', v_number, v_orig.id,
    v_orig.from_entity_type, v_orig.from_entity_id,
    v_orig.to_entity_type,   v_orig.to_entity_id,
    p_amount, p_amount, 0,
    jsonb_build_object(
      'union_id', v_union_id, 'union_name', v_union_name,
      'club_id', v_orig.club_id, 'club_name', v_club_name,
      'debit_note_for', COALESCE(v_orig.invoice_number, v_orig.id::text),
      'original_invoice_id', v_orig.id,
      'original_net_amount', v_orig.net_amount,
      'previously_credited', v_credited,
      'previously_charged', v_charged,
      'owed_before_this', v_owed,
      'reason', p_reason,
      'period_start', v_orig.breakdown->>'period_start',
      'period_end', v_orig.breakdown->>'period_end',
      'issued_at', now()),
    -- never due before it exists (2026-11-15, audit G5)
    'generated', false, GREATEST(v_orig.due_at, now() + interval '3 days'),
    'Charge note against ' || COALESCE(v_orig.invoice_number, v_orig.id::text) || '. ' || p_reason)
  RETURNING id INTO v_new_id;

  IF p_notify THEN
    v_msg := fn_union_send_club_message(
      v_union_id, v_orig.club_id,
      COALESCE(v_union_name, 'Union') || ' charge note ' || v_number,
      jsonb_build_object(
        'kind', 'union_debit_note',
        'debit_note_id', v_new_id,
        'debit_note_number', v_number,
        'adjusts_invoice_id', v_orig.id,
        'adjusts_invoice_number', v_orig.invoice_number,
        'amount', p_amount,
        'reason', p_reason),
      'invoice');

    IF COALESCE((v_msg->>'delivered')::int, 0) > 0 THEN
      UPDATE settlement_invoices
         SET message_sent = true, message_sent_at = now()
       WHERE id = v_new_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'debit_note_id', v_new_id,
    'debit_note_number', v_number,
    'adjusts', COALESCE(v_orig.invoice_number, v_orig.id::text),
    'amount', p_amount,
    'original_net', v_orig.net_amount,
    'total_credited', v_credited,
    'total_charged_now', round(v_charged + p_amount, 2),
    'owed_after', round(v_owed + p_amount, 2),
    'delivered', COALESCE((v_msg->>'delivered')::int,
                          (SELECT count(*)::int FROM accounting_invoice_deliveries d WHERE d.invoice_id = v_new_id)));
END $function$;

REVOKE ALL ON FUNCTION public.fn_union_issue_debit_note(uuid, numeric, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_union_issue_debit_note(uuid, numeric, text, boolean) TO authenticated, service_role;

DO $grants$
BEGIN
  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_union_issue_debit_note(uuid,numeric,text,boolean)'::regprocedure)
     IS DISTINCT FROM
     (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_union_issue_credit_note(uuid,numeric,text,boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'CHARGE_NOTE_GRANTS_DIFFER_FROM_CREDIT_NOTE' USING ERRCODE = '55000';
  END IF;
END
$grants$;

-- ==== SECTION 2: THE ONE CHARGE NOTE (audit D1, MIDWAY-2026-000034) ====

DO $charge$
DECLARE
  c_union constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_kings constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  c_reason constant text := 'Bad Beat Jackpot shares counted on the wrong club (owner rule 2026-11-15; audit D1, fix 20261115150131): '
    || '806.26 of shares played through The Felt Society were counted on this statement and 367.70 of shares played '
    || 'through KINGS CLUB were counted elsewhere, so player wins were 438.56 too high and cash ECO was under-billed by 43.86 '
    || '(cash profit 937,483.89 + 438.56 = 937,922.45; cash ECO 93,748.39 -> 93,792.25).';
  v_id uuid;
  v_misplaced numeric;
  v_charge numeric;
  v jsonb;
BEGIN
  SELECT s.id INTO v_id FROM public.settlement_invoices s
   WHERE s.invoice_number = 'MIDWAY-2026-000034' AND s.club_id = c_kings
     AND s.invoice_type = 'union_weekly_squareup'
     AND s.from_entity_type = 'club' AND s.to_entity_type = 'union'
     AND s.breakdown->>'union_id' = c_union::text
     AND s.breakdown->>'period_start' = '2026-10-26T07:00:00+00:00'
     AND s.breakdown->>'period_end' = '2026-11-02T08:00:00+00:00'
     AND s.net_amount = 110114.30
     AND s.status IN ('generated', 'overdue');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'CHARGE_NOTE_STATEMENT_CHANGED: MIDWAY-2026-000034' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.settlement_invoices dn
              WHERE dn.adjusts_invoice_id = v_id AND dn.invoice_type = 'union_weekly_debit_note'
                AND dn.breakdown->>'reason' LIKE 'Bad Beat Jackpot shares counted on the wrong club%') THEN
    RETURN;  -- already charged
  END IF;
  IF EXISTS (SELECT 1 FROM public.settlement_invoices n
              WHERE n.adjusts_invoice_id = v_id
                AND n.invoice_type IN ('union_weekly_debit_note', 'union_weekly_credit_note')) THEN
    RAISE EXCEPTION 'CHARGE_NOTE_OTHER_ADJUSTMENT_EXISTS: MIDWAY-2026-000034' USING ERRCODE = '55000';
  END IF;

  -- The cash ECO the statement quotes is unchanged.
  IF NOT EXISTS (
       SELECT 1 FROM public.settlement_invoices s, jsonb_array_elements(s.breakdown->'eco_components') c
        WHERE s.id = v_id AND c->>'activity' = 'cash' AND c->>'base_mode' = 'club_profit'
          AND (c->>'base')::numeric = 937483.89 AND (c->>'rate')::numeric = 0.10
          AND (c->>'amount')::numeric = -93748.39) THEN
    RAISE EXCEPTION 'CHARGE_NOTE_ECO_COMPONENT_CHANGED: MIDWAY-2026-000034' USING ERRCODE = '55000';
  END IF;

  -- Re-derive the misplaced shares from the rows: wallet club from the posted
  -- wallet leg, earning club from the hand's rake attribution.
  WITH shares AS (
    SELECT r.amount, cl.club_id AS wallet_club,
           (SELECT ra.club_id FROM public.rake_attributions ra
             WHERE ra.hand_id = b.hand_id AND ra.player_id = r.user_id AND ra.club_id IS NOT NULL
             ORDER BY ra.created_at DESC, ra.id DESC LIMIT 1) AS earn_club
      FROM public.bbj_payout_recipients r
      JOIN public.bbj_payouts b ON b.id = r.payout_id
      JOIN public.bbj_pools pool ON pool.id = b.pool_id
      JOIN public.chip_ledger cl ON cl.idempotency_key = 'bbj:' || b.id::text || ':' || r.user_id::text
                                AND cl.to_type = 'player_wallet' AND cl.status = 'posted'
     WHERE pool.union_id = c_union
       AND r.created_at >= '2026-10-26 07:00:00+00' AND r.created_at < '2026-11-02 08:00:00+00')
  SELECT round(COALESCE(sum(amount) FILTER (WHERE wallet_club = c_kings AND earn_club IS NOT NULL AND earn_club <> c_kings), 0)
             - COALESCE(sum(amount) FILTER (WHERE earn_club = c_kings AND wallet_club IS DISTINCT FROM c_kings), 0), 2)
    INTO v_misplaced FROM shares;
  v_charge := round(-0.10 * 937483.89, 2) - round(-0.10 * (937483.89 + v_misplaced), 2);
  IF v_misplaced IS DISTINCT FROM 438.56 OR v_charge IS DISTINCT FROM 43.86 THEN
    RAISE EXCEPTION 'CHARGE_NOTE_DERIVATION_MOVED: misplaced %, charge %', v_misplaced, v_charge USING ERRCODE = '55000';
  END IF;

  v := public.fn_union_issue_debit_note(v_id, v_charge, c_reason, false);
  IF (v->>'owed_after')::numeric IS DISTINCT FROM 110158.16
     OR public.fn_union_invoice_outstanding(v_id) IS DISTINCT FROM 110158.16 THEN
    RAISE EXCEPTION 'CHARGE_NOTE_OWED: %', v USING ERRCODE = '55000';
  END IF;
END
$charge$;

COMMIT;
