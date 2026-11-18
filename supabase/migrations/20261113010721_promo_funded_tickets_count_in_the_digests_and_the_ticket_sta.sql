-- 20261113010721_promo_funded_tickets_count_in_the_digests_and_the_ticket_sta.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Follow-up to 20261112184216 (promo funded cashier tickets), found by audit.
-- A promo funded ticket leaves the agent's promo wallet as one ledger leg,
-- category ticket_issue, promo_wallet -> escrow, and one receipt,
-- promo_wallet_send with destination tournament_ticket. Four readers were
-- written before that leg existed and looked for promo by category alone
-- (promo_send, promo), so promo given as a ticket was reported nowhere:
--
--  1. fn_ca_weekly_revenue_digest: "Player Promo And Leaderboard"
--     (promo_and_leaderboard_spend) now counts the ticket leg. It is counted
--     as promo to a player, not as a promo funding transfer.
--  2. fn_sp_daily_metrics_compute: money.promo_and_leaderboard now counts the
--     ticket leg.
--  3. fn_sp_digest_spins_spend: the daily digest's promo spend list now
--     carries the ticket leg, and names the ticket holder as its recipient
--     (horse or human, exactly as a wallet send is named).
--  4. fn_cashier_statement_rows: the statement's Ticket wallet filter now also
--     returns a promo ticket receipt. The receipt keeps wallet 'promo', so it
--     still appears under the Promo filter; no row changes its wallet,
--     direction, state or amount, and no other filter returns anything new.
--     The row is recognised as a promo_wallet_send receipt that names a
--     ticket_id, which only fn_cashier_promo_ticket_send writes.
--
-- All three digests count promo gross (none of them nets a promo claim back
-- or reversal), so a cancelled promo ticket is counted gross as well: its
-- refund leg (escrow -> promo_wallet) is not subtracted, the same as an
-- ordinary promo send that is later claimed back.
--
-- Readers only. Each function is patched from its live definition, refused
-- unless that definition is exactly the one read from production on
-- 2026-11-12, so owner, grants, SECURITY DEFINER, volatility and settings are
-- carried over untouched. No table, grant or data change. No function that
-- enforces a limit, routes money or reconciles the ledger is touched.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_weekly_revenue_digest(integer)'::regprocedure)) = '145597c5ec78386523b52e10d83ff29b' AND md5(pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure)) = '7b3118323fff5a16c6bdfc900871c14e' AND md5(pg_get_functiondef('public.fn_sp_digest_spins_spend(date)'::regprocedure)) = 'cc48246f155b78cd1443a63097848f56' AND md5(pg_get_functiondef('public.fn_cashier_statement_rows(uuid,uuid,text,timestamptz,timestamptz,jsonb,timestamptz,text,uuid,integer)'::regprocedure)) = 'dcfe58296b8a3d140f4fbdcc7395bd03')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE
  d text;
  n text;
BEGIN
  -- 1. Weekly revenue digest.
  d := pg_get_functiondef('public.fn_ca_weekly_revenue_digest(integer)'::regprocedure);
  IF md5(d) <> 'c48e3a4d068c77ecadf1fb0eb57cb7a5' THEN
    RAISE EXCEPTION 'Unexpected weekly revenue digest preimage';
  END IF;
  n := replace(d, '      COALESCE(sum(amount) FILTER(WHERE category IN(''promo_send'',''promo'',''leaderboard_payout'')
        AND to_type IN(''player_wallet'',''table_stack'')),0) player_promo,',
'      COALESCE(sum(amount) FILTER(WHERE (category IN(''promo_send'',''promo'',''leaderboard_payout'')
        AND to_type IN(''player_wallet'',''table_stack''))
        OR (category=''ticket_issue'' AND from_type=''promo_wallet'' AND to_type=''escrow'')),0) player_promo,');
  IF n = d THEN RAISE EXCEPTION 'Weekly revenue digest promo patch did not match'; END IF;
  EXECUTE n;

  -- 2. Daily digest metrics.
  d := pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure);
  IF md5(d) <> 'f2f9802c827e476246e335ba1d1596f0' THEN
    RAISE EXCEPTION 'Unexpected daily metrics preimage';
  END IF;
  n := replace(d, '(SELECT sum(amount) FROM cl WHERE category IN (''promo_send'',''promo'',''leaderboard_payout'',''club_opening_allocation'')),0),2),',
'(SELECT sum(amount) FROM cl WHERE category IN (''promo_send'',''promo'',''leaderboard_payout'',''club_opening_allocation'')
         OR (category = ''ticket_issue'' AND from_type = ''promo_wallet'' AND to_type = ''escrow'')),0),2),');
  IF n = d THEN RAISE EXCEPTION 'Daily metrics promo patch did not match'; END IF;
  EXECUTE n;

  -- 3. Daily digest promo spend list.
  d := pg_get_functiondef('public.fn_sp_digest_spins_spend(date)'::regprocedure);
  IF md5(d) <> 'f67a7895b96362ef9daef978d1e34494' THEN
    RAISE EXCEPTION 'Unexpected digest spend preimage';
  END IF;
  n := replace(d, ' FROM public.chip_ledger l LEFT JOIN public.profiles p ON p.id=l.to_entity_id AND l.to_type=''player_wallet''',
' FROM public.chip_ledger l
 LEFT JOIN public.tournament_tickets tk ON tk.id=l.to_entity_id AND l.to_type=''escrow'' AND l.category=''ticket_issue'' AND l.from_type=''promo_wallet''
 LEFT JOIN public.profiles p ON p.id=CASE WHEN l.to_type=''player_wallet'' THEN l.to_entity_id ELSE tk.holder_id END');
  IF n = d THEN RAISE EXCEPTION 'Digest spend recipient patch did not match'; END IF;
  d := n;
  n := replace(d, ' AND (l.category IN (''promo_send'',''promo'',''leaderboard_payout'',''club_opening_allocation'')
 OR (l.from_label IN',
' AND (l.category IN (''promo_send'',''promo'',''leaderboard_payout'',''club_opening_allocation'')
 OR (l.category=''ticket_issue'' AND l.from_type=''promo_wallet'' AND l.to_type=''escrow'')
 OR (l.from_label IN');
  IF n = d THEN RAISE EXCEPTION 'Digest spend promo patch did not match'; END IF;
  EXECUTE n;

  -- 4. Cashier statement Ticket filter.
  d := pg_get_functiondef('public.fn_cashier_statement_rows(uuid,uuid,text,timestamptz,timestamptz,jsonb,timestamptz,text,uuid,integer)'::regprocedure);
  IF md5(d) <> '8cab96c15ba360fb34c13f0afd3378b8' THEN
    RAISE EXCEPTION 'Unexpected cashier statement rows preimage';
  END IF;
  n := replace(d, ' WHERE ($10::text IS NULL OR r.wallet = $10)
',
' WHERE ($10::text IS NULL OR r.wallet = $10
        OR ($10 = ''ticket'' AND r.source = ''receipt'' AND r.kind = ''promo_wallet_send'' AND r.ticket_id IS NOT NULL))
');
  IF n = d THEN RAISE EXCEPTION 'Cashier statement ticket filter patch did not match'; END IF;
  EXECUTE n;
END
$patch$;

COMMIT;
