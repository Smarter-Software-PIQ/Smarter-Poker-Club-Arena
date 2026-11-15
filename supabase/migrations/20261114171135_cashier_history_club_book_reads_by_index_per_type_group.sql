-- 20261114171135_cashier_history_club_book_reads_by_index_per_type_group.sql
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Cashier > Transaction History > All Time on a large club answered
-- "Could not load your transaction history" (HTTP 500, statement timeout).
-- Root cause, measured 2026-11-14 on KINGS CLUB: the club book picked its
-- newest page with ONE filter over idx_chip_tx_club_created, but the club has
-- 1,073,286 ledger rows and only 16,307 are cashier types, so the "All" and
-- "Cash-Outs" kinds walked the whole club in date order. The transfer types
-- already have a partial index (idx_chip_tx_club_transfer_created); an OR with
-- the cash-out types kept the planner from using it.
--
-- The club book now reads each type group off its own index and merges the
-- two newest-first runs (EXPLAIN ANALYZE on KINGS CLUB, All, newest 51 rows:
-- 16.6 ms). Same signature, same rows, same order, same columns, same
-- security and grants; the person / downline / search books are unchanged.
-- Function-only change: no hot-table DDL, no records rewritten, no engine
-- dependency.
--
-- FIXED IN PLACE 2026-11-14 after the applier refused it ("History Source
-- Changed"): a later migration had changed the function's name columns, and
-- this file carried a whole copy of the older body under the older md5, so the
-- guard rolled it back and nothing was installed. It is now a patch of the
-- installed source: four anchors, each required to match exactly once, under
-- the current md5. Only the club book's row picker changes; every other line
-- of the installed function, including the newer name columns, is kept.
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure) LIKE '%Each type group%')


BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION pg_temp.ca_patch(p_fn regprocedure, p_md5 text, p_pairs text[])
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i int;
BEGIN
  IF md5(d) <> p_md5 THEN RAISE EXCEPTION 'Source Changed: %', p_fn; END IF;
  FOR i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    IF (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]) <> 1 THEN
      RAISE EXCEPTION 'Anchor Not Unique In %: %', p_fn, p_pairs[i];
    END IF;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  END LOOP;
  EXECUTE d;
END
$patch$;

SELECT pg_temp.ca_patch(
  'public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure,
  '44c175c992ce8154c48347d8aac25fab',
  ARRAY[
    -- 1. The range, cursor and invoice clauses without the type clause.
    $a$  v_pick text;
  c_cashout$a$,
    $a$  v_pick text;
  v_rest text;
  c_cashout$a$,
    $a$    || CASE WHEN p_before_at IS NOT NULL THEN ' AND (ct.created_at, ct.id) < ($6, $7)' ELSE '' END;

  IF v_search IS NOT NULL THEN$a$,
    $a$    || CASE WHEN p_before_at IS NOT NULL THEN ' AND (ct.created_at, ct.id) < ($6, $7)' ELSE '' END;
  v_rest := CASE WHEN p_from IS NOT NULL THEN ' AND ct.created_at >= $4' ELSE '' END
    || CASE WHEN p_to IS NOT NULL THEN ' AND ct.created_at < $5' ELSE '' END
    || CASE WHEN p_before_at IS NOT NULL THEN ' AND (ct.created_at, ct.id) < ($6, $7)' ELSE '' END;

  IF v_search IS NOT NULL THEN$a$,
    $a$      v_filter := v_filter || ' AND ct.id = ANY ($9)';
$a$,
    $a$      v_filter := v_filter || ' AND ct.id = ANY ($9)';
      v_rest := v_rest || ' AND ct.id = ANY ($9)';
$a$,
    -- 2. The club book reads each type group off its own index.
    $a$  IF v_book = 'club' THEN
    v_pick := 'SELECT ct.id FROM public.chip_transactions ct WHERE ct.club_id = $1' || v_filter
      || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8';$a$,
    $a$  IF v_book = 'club' THEN
    -- The club book is mostly game rows (1,073,286 club rows, 16,307 of them
    -- cashier types, 2026-11-14), so one filter over the (club_id, created_at)
    -- index walked the whole club and timed out on All Time. Each type group
    -- reads its own index instead: transfers off the partial
    -- idx_chip_tx_club_transfer_created, cash-outs off the transaction_type
    -- index (a few dozen rows per club), then the two newest-first runs merge.
    -- v_rest carries the range, cursor and invoice search without the type.
    v_pick := CASE v_kind
      WHEN 'game' THEN 'SELECT NULL::uuid AS id WHERE false'
      WHEN 'cashout' THEN
        'SELECT x.id FROM (SELECT ct.id, ct.created_at FROM public.chip_transactions ct WHERE ct.club_id = $1'
        || ' AND ct.transaction_type = ANY (' || c_cashout || ')' || v_rest
        || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8) x ORDER BY x.created_at DESC, x.id DESC'
      WHEN 'transfer' THEN
        'SELECT x.id FROM (SELECT ct.id, ct.created_at FROM public.chip_transactions ct WHERE ct.club_id = $1'
        || ' AND ct.transaction_type = ANY (' || c_transfer || ')' || v_rest
        || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8) x ORDER BY x.created_at DESC, x.id DESC'
      ELSE
        'SELECT x.id FROM ('
        || '(SELECT ct.id, ct.created_at FROM public.chip_transactions ct WHERE ct.club_id = $1'
        || ' AND ct.transaction_type = ANY (' || c_transfer || ')' || v_rest
        || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8)'
        || ' UNION ALL '
        || '(SELECT ct.id, ct.created_at FROM public.chip_transactions ct WHERE ct.club_id = $1'
        || ' AND ct.transaction_type = ANY (' || c_cashout || ')' || v_rest
        || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8)'
        || ') x ORDER BY x.created_at DESC, x.id DESC LIMIT $8' END;$a$
  ]);

DROP FUNCTION pg_temp.ca_patch(regprocedure, text, text[]);

COMMIT;
