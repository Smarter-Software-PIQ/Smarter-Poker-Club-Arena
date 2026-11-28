-- 20261116034302_a_club_owner_can_download_its_union_statement
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-16 03:43:02 UTC.
--
-- WHAT WAS WRONG, READ FROM PRODUCTION (read-only, 2026-11-16 03:40 UTC).
--   * A club owner could not download their club's weekly union statement.
--     The only club-side reader, ca_club_union_invoices, returns the raw
--     square-up row: no statement number, no credit notes, no charge notes,
--     and its "outstanding" is abs(net_amount) less payments, ignoring
--     credit notes. KINGS CLUB's MIDWAY-2026-000039 (6,042.96, credited 21.25
--     by MIDWAY-2026-000045 on 2026-11-15) therefore reads 6,042.96
--     outstanding on the club's own page while the union's board and the
--     statement message both say 6,021.71.
--   * The union's Download Statement printed credit notes without their
--     dates: ca_union_statement_board's credit_notes carry only number and
--     amount.
--
-- WHAT THIS CHANGES.
--   1. public.ca_union_statement_document(p_invoice_id): one issued
--      union_weekly_squareup in exactly the board's row shape (so the client
--      checks it with the board's own per-row rules), plus every credit note
--      and charge note against it with number, amount, issue time and
--      status, cancelled notes excluded, and remaining_after_credits from
--      fn_union_invoice_outstanding. Read-only, STABLE, SECURITY DEFINER.
--      Who may read it is decided by the two rules that already decide who
--      reads statements, unchanged:
--        - ca_can_oversee_union(issuing union), the board's rule: union
--          owner, union admin, union-club owner/co-owner/admin, platform admin;
--        - ca_can_view_whole_club_report(statement's club), the rule of
--          ca_club_union_invoices (fn_ca_club_data_scope = 'club'): the club
--          owner, a platform admin, or an active club member with role owner,
--          co_owner or admin. Agents ('downline' scope), players and other
--          clubs get nothing.
--      A missing statement and somebody else's statement raise the same
--      42501, so the reader is not an existence oracle. EXECUTE to
--      authenticated and service_role only.
--   2. ca_club_union_invoices (md5-pinned, two anchors): each row also
--      carries invoice_number and remaining_after_credits, and outstanding is
--      what fn_union_invoice_outstanding leaves less payments, never below 0.
--
-- CHARGE NOTES (draft PR #11015, union_weekly_debit_note). Nothing here
-- depends on it: the reader selects invoice_type IN (credit, debit) and reads
-- what remains through fn_union_invoice_outstanding, which #11015 teaches to
-- add charge notes. Before #11015 no debit note can exist and the function
-- subtracts credit notes only; after it, the same SQL lists charge notes and
-- the remaining figure includes them. fn_union_invoice_outstanding is
-- therefore required to exist but deliberately not md5-pinned (#11015 changes
-- its body); every other dependency is pinned. Neither file patches a
-- function the other patches, so they install in either order.
--
-- Isolated proof: scripts/ci/test-union-statement-document-postgres.py
-- (PostgreSQL 17, production bodies captured read-only, callers through an
-- authenticator login switched to role authenticated, as PostgREST does).
--
-- TIMING: not to be installed before 2026-11-16 13:00 UTC (the weekly
-- rakeback run at 10:00 UTC). Draft, do-not-merge.
--
-- @live-proof: to_regprocedure('public.ca_union_statement_document(uuid)') IS NOT NULL AND has_function_privilege('authenticated', 'public.ca_union_statement_document(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ca_union_statement_document(uuid)', 'EXECUTE') AND position('fn_union_invoice_outstanding(i.id)' IN pg_get_functiondef('public.ca_club_union_invoices(uuid,integer)'::regprocedure))>0 AND position('''invoice_number'', i.invoice_number' IN pg_get_functiondef('public.ca_club_union_invoices(uuid,integer)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. Preimages: the rules this file relies on are the ones it was qualified
--    against, and the reader does not exist yet.
-- ---------------------------------------------------------------------------
DO $preimage$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.ca_can_oversee_union(uuid)', '79cb90482aa4af61ea4e6a286768efa4'),
      ('public.ca_can_view_whole_club_report(uuid)', 'b9270b60a0732bb5730f31a475083657'),
      ('public.fn_ca_club_data_scope(uuid)', '882099046280f5245d58d07cbb99c26b'),
      ('public.fn_is_union_overseer(uuid,uuid)', 'f16c14bc47eb6e6db203412b683ea5f4'),
      ('public.fn_union_overseer_of_record(uuid,uuid)', '7f892f09fed9a0a768b2741a69ddf6b2'),
      ('public.fn_cashier_member_is_active(uuid,uuid)', '2cabb4a5d0eb8e1cbb32d25cf4c4fa34'),
      ('public.ca_club_union_invoices(uuid,integer)', '20148cb3fa6658a7b387e2a7b7496f35')
    ) x(sig, hash) LOOP
    IF to_regprocedure(f.sig) IS NULL
       OR md5(pg_get_functiondef(f.sig::regprocedure)) IS DISTINCT FROM f.hash THEN
      RAISE EXCEPTION 'STATEMENT_DOCUMENT_PREIMAGE_CHANGED: %', f.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF to_regprocedure('public.fn_union_invoice_outstanding(uuid)') IS NULL
     OR (SELECT p.prorettype FROM pg_proc p
          WHERE p.oid = 'public.fn_union_invoice_outstanding(uuid)'::regprocedure) <> 'numeric'::regtype THEN
    RAISE EXCEPTION 'STATEMENT_DOCUMENT_OUTSTANDING_MISSING' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.ca_union_statement_document(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'STATEMENT_DOCUMENT_ALREADY_EXISTS' USING ERRCODE = '55000';
  END IF;
END
$preimage$;

-- ---------------------------------------------------------------------------
-- 1. The statement document reader: one issued weekly union statement, in the
--    board's own row shape, with every credit and charge note dated.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ca_union_statement_document(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  i        settlement_invoices%ROWTYPE;
  v_union  uuid;
  v_avail  boolean;
  v_paid   numeric;
  v_after  numeric;
  v_row    jsonb;
  v_notes  jsonb;
BEGIN
  SELECT * INTO i FROM settlement_invoices s
   WHERE s.id = p_invoice_id AND s.invoice_type = 'union_weekly_squareup';
  IF FOUND AND pg_input_is_valid(i.breakdown->>'union_id', 'uuid') THEN
    v_union := (i.breakdown->>'union_id')::uuid;
  END IF;
  -- Who may read it is who may already read it elsewhere: the issuing
  -- union's overseers (ca_can_oversee_union, the board's rule) and the
  -- club's whole-club report readers (ca_can_view_whole_club_report, the
  -- club data page's rule for ca_club_union_invoices). A missing statement
  -- and someone else's statement get the same answer.
  IF v_union IS NULL
     OR NOT (COALESCE(ca_can_oversee_union(v_union), false)
             OR COALESCE(ca_can_view_whole_club_report(i.club_id), false)) THEN
    RAISE EXCEPTION 'not authorized for this statement' USING ERRCODE = '42501';
  END IF;

  v_avail := i.status <> 'paid' OR COALESCE(i.net_amount, 0) = 0
             OR i.breakdown->>'paid_total' IS NOT NULL;
  v_paid  := COALESCE((i.breakdown->>'paid_total')::numeric, 0);
  -- What remains after every note: the one definition every union reader
  -- uses (credit notes less; once charge notes exist, charge notes more).
  v_after := public.fn_union_invoice_outstanding(i.id);

  SELECT jsonb_agg(jsonb_build_object(
           'kind', CASE n.invoice_type WHEN 'union_weekly_credit_note' THEN 'credit' ELSE 'charge' END,
           'invoice_number', n.invoice_number,
           'amount', round(n.net_amount, 2),
           'issued_at', n.created_at,
           'status', n.status)
         ORDER BY n.created_at, n.invoice_number)
    INTO v_notes
    FROM settlement_invoices n
   WHERE n.adjusts_invoice_id = i.id
     AND n.invoice_type IN ('union_weekly_credit_note', 'union_weekly_debit_note')
     AND n.status IS DISTINCT FROM 'cancelled';

  SELECT jsonb_build_object(
      'club_id', i.club_id,
      'club_name', COALESCE(c.name, i.breakdown->>'club_name'),
      'club_code', c.code, 'club_slug', c.slug,
      'invoice_id', i.id, 'status', i.status,
      'snapshot_complete', (i.net_amount IS NOT NULL
             AND i.breakdown->>'rake_generated' IS NOT NULL
             AND i.breakdown->>'rakeback_due' IS NOT NULL
             AND i.breakdown->>'union_fee_kept' IS NOT NULL),
      'issued_at', i.created_at, 'due_at', i.due_at,
      'amount', round(COALESCE(i.net_amount, 0), 2),
      'direction', i.breakdown->>'direction',
      'message_sent', EXISTS (SELECT 1 FROM accounting_invoice_deliveries d WHERE d.invoice_id = i.id),
      'payment_details_available', v_avail,
      'paid_total', CASE WHEN v_avail THEN round(v_paid, 2) END,
      'outstanding', CASE WHEN v_avail THEN round(GREATEST(COALESCE(v_after, abs(i.net_amount)) - v_paid, 0), 2) END,
      'overdue', (i.status NOT IN ('paid', 'cancelled') AND i.due_at IS NOT NULL AND i.due_at < now()),
      'rake_generated', round(COALESCE((i.breakdown->>'rake_generated')::numeric, 0), 2),
      'rakeback_due', round(COALESCE((i.breakdown->>'rakeback_due')::numeric, 0), 2),
      'union_fee_kept', round(COALESCE((i.breakdown->>'union_fee_kept')::numeric, 0), 2),
      'players_won', round(COALESCE((i.breakdown->>'players_won')::numeric, 0), 2),
      'weekly_player_results', i.breakdown->'weekly_player_results',
      'invoice_number', i.invoice_number,
      'period_start_at', CASE WHEN pg_input_is_valid(i.breakdown->>'period_start', 'timestamptz')
                              THEN (i.breakdown->>'period_start')::timestamptz END,
      'period_end_at', CASE WHEN pg_input_is_valid(i.breakdown->>'period_end', 'timestamptz')
                            THEN (i.breakdown->>'period_end')::timestamptz END,
      'payer_type', i.from_entity_type,
      'payer_name', CASE i.from_entity_type
         WHEN 'union' THEN (SELECT u.name FROM unions u WHERE u.id = CASE WHEN pg_input_is_valid(i.from_entity_id, 'uuid') THEN i.from_entity_id::uuid END)
         WHEN 'club' THEN (SELECT pc.name FROM clubs pc WHERE pc.id = CASE WHEN pg_input_is_valid(i.from_entity_id, 'uuid') THEN i.from_entity_id::uuid END) END,
      'payee_type', i.to_entity_type,
      'payee_name', CASE i.to_entity_type
         WHEN 'union' THEN (SELECT u.name FROM unions u WHERE u.id = CASE WHEN pg_input_is_valid(i.to_entity_id, 'uuid') THEN i.to_entity_id::uuid END)
         WHEN 'club' THEN (SELECT pc.name FROM clubs pc WHERE pc.id = CASE WHEN pg_input_is_valid(i.to_entity_id, 'uuid') THEN i.to_entity_id::uuid END) END,
      'union_house', (i.club_id = v_union),
      'settled_in_chips', CASE WHEN jsonb_typeof(i.breakdown->'settled_in_chips') = 'number'
                               THEN round((i.breakdown->>'settled_in_chips')::numeric, 2) END,
      'player_pnl_net', CASE WHEN jsonb_typeof(i.breakdown->'player_pnl_net') = 'number'
                             THEN round((i.breakdown->>'player_pnl_net')::numeric, 2) END,
      'stored_outstanding', CASE WHEN jsonb_typeof(i.breakdown->'outstanding') = 'number'
                                 THEN round((i.breakdown->>'outstanding')::numeric, 2) END,
      'credit_notes', (SELECT jsonb_agg(jsonb_build_object('invoice_number', e->>'invoice_number', 'amount', e->'amount'))
                         FROM jsonb_array_elements(v_notes) e WHERE e->>'kind' = 'credit'),
      'charge_notes', (SELECT jsonb_agg(jsonb_build_object('invoice_number', e->>'invoice_number', 'amount', e->'amount'))
                         FROM jsonb_array_elements(v_notes) e WHERE e->>'kind' = 'charge'),
      'remaining_after_credits', round(v_after, 2),
      'eco_amount', round(COALESCE((i.breakdown->>'eco_amount')::numeric, 0), 2),
      'eco_version', COALESCE(i.breakdown->'eco_version', '1'::jsonb),
      'eco_components', CASE WHEN i.breakdown->'eco_version' = '2'::jsonb THEN i.breakdown->'eco_components' END,
      'presettled', round(COALESCE((i.breakdown->>'presettled')::numeric, 0), 2))
    INTO v_row
    FROM (SELECT 1) one
    LEFT JOIN clubs c ON c.id = i.club_id;

  RETURN jsonb_build_object(
    'union_id', v_union,
    'union_name', COALESCE((SELECT u.name FROM unions u WHERE u.id = v_union), i.breakdown->>'union_name'),
    'statement', v_row,
    'notes', COALESCE(v_notes, '[]'::jsonb),
    'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.ca_union_statement_document(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ca_union_statement_document(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The club's own statement list owes what the statement owes after notes,
--    and carries its number.
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  sig constant regprocedure := 'public.ca_club_union_invoices(uuid,integer)'::regprocedure;
  d text := pg_get_functiondef(sig);
  r record; m jsonb; m2 jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ($a$             'invoice_id', i.id,$a$,
       $a$             'invoice_id', i.id,
             'invoice_number', i.invoice_number,$a$),
      ($a$             'outstanding', round(GREATEST(
                 abs(COALESCE(i.net_amount, 0))
                 - COALESCE((i.breakdown->>'paid_total')::numeric, 0), 0), 2),$a$,
       $a$             -- What is left after credit notes (and, once they exist, charge
             -- notes) less payments: fn_union_invoice_outstanding, the
             -- board's definition (2026-11-16).
             'outstanding', round(GREATEST(
                 COALESCE(public.fn_union_invoice_outstanding(i.id), abs(COALESCE(i.net_amount, 0)))
                 - COALESCE((i.breakdown->>'paid_total')::numeric, 0), 0), 2),
             'remaining_after_credits', round(public.fn_union_invoice_outstanding(i.id), 2),$a$)
    ) p(anchor, replacement) LOOP
    IF (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor) <> 1 THEN
      RAISE EXCEPTION 'STATEMENT_DOCUMENT_ANCHOR: %', left(r.anchor, 60) USING ERRCODE = '55000';
    END IF;
    d := replace(d, r.anchor, r.replacement);
  END LOOP;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile::text)
    INTO m FROM pg_proc WHERE oid = sig;
  EXECUTE d;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile::text)
    INTO m2 FROM pg_proc WHERE oid = sig;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(sig) <> d THEN
    RAISE EXCEPTION 'STATEMENT_DOCUMENT_POSTIMAGE: %', md5(pg_get_functiondef(sig)) USING ERRCODE = '55000';
  END IF;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 3. Postimage: the reader is a read-only definer function that only
--    signed-in callers and the server may run.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE p record;
BEGIN
  SELECT prosecdef, provolatile::text AS v, proconfig INTO p FROM pg_proc
   WHERE oid = 'public.ca_union_statement_document(uuid)'::regprocedure;
  IF NOT p.prosecdef OR p.v <> 's' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'STATEMENT_DOCUMENT_SHAPE: % % %', p.prosecdef::text, p.v, p.proconfig::text USING ERRCODE = '55000';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ca_union_statement_document(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ca_union_statement_document(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ca_union_statement_document(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STATEMENT_DOCUMENT_GRANTS' USING ERRCODE = '55000';
  END IF;
END
$verify$;

COMMIT;
