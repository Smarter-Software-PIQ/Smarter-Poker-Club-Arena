-- 20261113021529_a_promo_ticket_names_itself_and_its_cancel_refund_files_unde.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Final polish of 20261112184216 (promo funded cashier tickets).
--
--  1. fn_cashier_promo_ticket_send writes the ticket note 'Promo Cashier
--     Ticket' instead of 'Cashier Ticket'. Nothing on a tournament_tickets row
--     said the ticket was promo funded, so the Tickets tab could not tell its
--     issuer that Cancel returns the chips to the Promo Wallet. No function
--     reads a ticket row's note: the one 'Cashier Ticket' comparison in
--     production (fn_cashier_browser_recovery_valid) reads the browser's
--     recovery envelope, which this door never receives. Which wallet a cancel
--     refunds is still decided by the issue receipt, never by the note.
--     Tickets issued before this file keep their note (production held no
--     promo ticket when this was written, 2026-11-12).
--
--  2. fn_cashier_statement_rows files a 'refund' ledger leg that touches the
--     ticket escrow under the Ticket wallet filter instead of Cashout. The
--     refund category on an escrow leg exists only since 20261112184950 and
--     only two doors declare it: fn_cancel_tournament_ticket and the issuer
--     return of fn_ca_settle_closed_cashier_entry_tickets. Both return an
--     issued ticket's escrow to its issuer. Production held no such leg when
--     this was written, so no existing statement row changes its wallet. The
--     cashout queue's own legs (escrow_hold, escrow_release) are untouched.
--
-- Each function is patched from its live definition, refused unless that
-- definition is exactly the one read from production on 2026-11-12, so owner,
-- grants, SECURITY DEFINER, volatility and settings carry over untouched. No
-- table, grant or data change.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_cashier_promo_ticket_send(uuid,uuid,numeric,text)'::regprocedure)) = '310b74c72f83bf023dc25a64f9950486' AND md5(pg_get_functiondef('public.fn_cashier_statement_rows(uuid,uuid,text,timestamptz,timestamptz,jsonb,timestamptz,text,uuid,integer)'::regprocedure)) = '014595799a63ab71d190a68c7acdbcac')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE
  d text;
  n text;
BEGIN
  -- 1. The promo ticket door names its ticket.
  d := pg_get_functiondef('public.fn_cashier_promo_ticket_send(uuid,uuid,numeric,text)'::regprocedure);
  IF md5(d) <> '499b323c2479bc774a1674db7f99f9ec' THEN
    RAISE EXCEPTION 'Unexpected promo ticket send preimage';
  END IF;
  n := replace(d, '  values (v_ticket_id, p_club_id, v_me, p_holder_id, p_value, ''Cashier Ticket'');',
'  values (v_ticket_id, p_club_id, v_me, p_holder_id, p_value, ''Promo Cashier Ticket'');');
  IF n = d THEN RAISE EXCEPTION 'Promo ticket note patch did not match'; END IF;
  EXECUTE n;

  -- 2. A ticket escrow refund files under the statement's Ticket wallet.
  d := pg_get_functiondef('public.fn_cashier_statement_rows(uuid,uuid,text,timestamptz,timestamptz,jsonb,timestamptz,text,uuid,integer)'::regprocedure);
  IF md5(d) <> 'dcfe58296b8a3d140f4fbdcc7395bd03' THEN
    RAISE EXCEPTION 'Unexpected cashier statement rows preimage';
  END IF;
  n := replace(d, '           WHEN ''escrow'' IN (cl.from_type, cl.to_type) THEN ''cashout''
',
'           WHEN cl.category = ''refund'' AND ''escrow'' IN (cl.from_type, cl.to_type) THEN ''ticket''
           WHEN ''escrow'' IN (cl.from_type, cl.to_type) THEN ''cashout''
');
  IF n = d THEN RAISE EXCEPTION 'Cashier statement ticket refund patch did not match'; END IF;
  EXECUTE n;
END
$patch$;

COMMIT;
