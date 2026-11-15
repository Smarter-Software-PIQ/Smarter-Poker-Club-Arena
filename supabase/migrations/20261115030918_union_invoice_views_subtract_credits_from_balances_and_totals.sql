-- 20261115030918_union_invoice_views_subtract_credits_from_balances_and_totals
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 03:09:18 UTC.
--
-- FOLLOW-UP TO 20261115011424 (PR #10897), from its independent review of the
-- merged head (owner specification 2026-11-14, item 8):
--
--   1. The Messenger body said "The Lines Below Are Counted From The Club's
--      Side: Positive Means Players Lost Or The Club Pays" above a list that
--      includes "Less Club Rakeback Credit". The rakeback credit is always
--      the union crediting the club; it is subtracted in the full weekly net,
--      not a club payment. The sentence now names only the lines it covers.
--   2. "Remaining Unpaid Balance" on the board was the document amount less
--      payments (GREATEST(abs(amount) - paid_total, 0)), while "Amount Due"
--      subtracts credit notes. A square-up reduced by a credit note therefore
--      read as still owing its credited part. The board's per-row and total
--      outstanding are now the amount after credit notes
--      (fn_union_invoice_outstanding) less payments, and the Messenger body
--      states the same remaining unpaid balance.
--
-- Read 2026-11-15: no union_weekly_squareup carries a paid_total, eight
-- historical square-ups are credited in full (all status paid, payment
-- details unavailable, so the board already returns their outstanding as
-- null), and none of the five rows for the week ending 2026-11-09 has a
-- credit note. No board figure for an existing row changes value; the
-- definition now holds for any later credited, part-paid invoice.
--
-- Presentation only: no stored invoice, amount, number, status or delivery
-- flag is written; nothing is sent. Both functions are patched from their
-- installed sources under md5 guards; every anchor must occur exactly once.
-- Function-only: no table DDL, no hot-table lock, no engine dependency.
--
-- @live-proof: position('COALESCE(b.remaining_after_credits, abs(b.amount)) - b.paid_total' IN pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure))>0 AND position('Remaining Unpaid Balance: ' IN pg_get_functiondef('smarter_private.union_weekly_invoice_body(uuid)'::regprocedure))>0 AND position('Less Club Rakeback Credit Is The Rakeback' IN pg_get_functiondef('smarter_private.union_weekly_invoice_body(uuid)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION pg_temp.ca_patch(p_fn regprocedure, p_md5 text, p_pairs text[])
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i int;
BEGIN
  IF md5(d) <> p_md5 THEN RAISE EXCEPTION 'UNION_INVOICE_BALANCES_SOURCE_CHANGED: %', p_fn; END IF;
  FOR i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    IF (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]) <> 1 THEN
      RAISE EXCEPTION 'UNION_INVOICE_BALANCES_ANCHOR_NOT_UNIQUE in %: %', p_fn, p_pairs[i];
    END IF;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  END LOOP;
  EXECUTE d;
END
$patch$;

-- 1. The board's unpaid balance is the amount after credit notes less payments.
SELECT pg_temp.ca_patch(
  'public.ca_union_statement_board(uuid,date,integer)'::regprocedure,
  'a95dd4e582a6888bcd08b7e8d4c9ddb0',
  ARRAY[
    $a$                     GREATEST(abs(b.amount) - b.paid_total, 0))$a$,
    $a$                     GREATEST(COALESCE(b.remaining_after_credits, abs(b.amount)) - b.paid_total, 0))$a$,
    $a$'outstanding', CASE WHEN b.payment_details_available THEN round(GREATEST(abs(b.amount) - b.paid_total, 0), 2) END,$a$,
    $a$'outstanding', CASE WHEN b.payment_details_available THEN round(GREATEST(COALESCE(b.remaining_after_credits, abs(b.amount)) - b.paid_total, 0), 2) END,$a$
  ]);

-- 2. The Messenger body: the sign sentence names only its lines, and the
--    remaining unpaid balance is stated after credit notes and payments.
SELECT pg_temp.ca_patch(
  'smarter_private.union_weekly_invoice_body(uuid)'::regprocedure,
  'a7276e1a0f917bc06a8a3da7a0167c97',
  ARRAY[
    $a$  v_remaining numeric;
BEGIN$a$,
    $a$  v_remaining numeric;
  v_paid numeric;
BEGIN$a$,
    $a$      || E'\nThe Lines Below Are Counted From The Club''s Side: Positive Means Players Lost Or The Club Pays.'$a$,
    $a$      || E'\nThe Net Loss, ECO Charge And Full Weekly Net Lines Below Are Counted From The Club''s Side: '
      || 'Positive Means Players Lost Or The Club Pays. Less Club Rakeback Credit Is The Rakeback '
      || 'The Union Paid The Club, Subtracted In The Full Weekly Net.'$a$,
    $a$                     || ' Leaves ' || smarter_private.union_statement_figure(greatest(v_remaining, 0)) || ' Due'
                   ELSE '' END
       ELSE '' END;$a$,
    $a$                     || ' Leaves ' || smarter_private.union_statement_figure(greatest(v_remaining, 0)) || ' Due'
                   ELSE '' END
       ELSE '' END;
  v_paid := CASE WHEN jsonb_typeof(b->'paid_total') = 'number' THEN (b->>'paid_total')::numeric ELSE 0 END;
  v_body := v_body
    || CASE WHEN v_paid > 0 THEN E'\nPaid So Far: ' || smarter_private.union_statement_figure(v_paid) ELSE '' END
    || E'\nRemaining Unpaid Balance: '
    || smarter_private.union_statement_figure(CASE WHEN v_square THEN 0 ELSE greatest(v_remaining - v_paid, 0) END);$a$
  ]);

DROP FUNCTION pg_temp.ca_patch(regprocedure, text, text[]);

DO $verify$
BEGIN
  IF position('COALESCE(b.remaining_after_credits, abs(b.amount)) - b.paid_total' IN pg_get_functiondef('public.ca_union_statement_board(uuid,date,integer)'::regprocedure)) = 0
     OR position('Remaining Unpaid Balance: ' IN pg_get_functiondef('smarter_private.union_weekly_invoice_body(uuid)'::regprocedure)) = 0
     OR position('Less Club Rakeback Credit Is The Rakeback' IN pg_get_functiondef('smarter_private.union_weekly_invoice_body(uuid)'::regprocedure)) = 0
     OR has_function_privilege('authenticated', 'smarter_private.union_weekly_invoice_body(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'UNION_INVOICE_BALANCES_INSTALL_MISMATCH';
  END IF;
END
$verify$;

COMMIT;
