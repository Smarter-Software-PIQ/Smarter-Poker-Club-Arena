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
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure) LIKE '%Each type group%')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $$ BEGIN IF md5(pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure)) <> 'dad4d92ef739f520d0c512c9950d5c62' THEN RAISE EXCEPTION 'History Source Changed: fn_cashier_history_feed'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.fn_cashier_history_feed(p_club_id uuid, p_scope text DEFAULT 'mine'::text, p_kind text DEFAULT 'all'::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_person uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, transaction_type text, amount numeric, from_user_id uuid, to_user_id uuid, notes text, metadata jsonb, from_name text, to_name text, request_status text, request_created_at timestamp with time zone, invoice_number text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, 'all')));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  -- 250 rows on screen plus one sentinel row, as fn_club_trade_ledger.
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 251);
  v_book text;
  v_people uuid[];
  v_subject uuid;
  v_ids uuid[];
  v_match uuid[];
  v_filter text;
  v_pick text;
  v_rest text;
  c_cashout constant text := $k$'{cashout_request_escrow,cashout_approved,cashout_denied,cashout_cancelled,cashout_expired_refund}'::text[]$k$;
  c_transfer constant text := $k$'{agent_wallet_send,agent_wallet_claim_back,agent_wallet_self_stake,club_bank_send,horse_treasury_funding,club_bank_claim,club_bank_reversal,admin_removal,mint,treasury_mint,treasury_burn,treasury_debit,treasury_credit,peer_transfer,promo_wallet_send,club_promo_send,promo_disbursement,club_opening_grant,rakeback,commission_claim,overlay_funding,overlay_rebank,union_transfer,union_transfer_reversal,union_promo_send,union_promo_to_club,union_promo_clawback,union_clawback,leave_club_chip_return,default_mint_correction,promo_closed_on_union_join,tournament_ticket_issue,tournament_ticket_cancel,transfer}'::text[]$k$;
  v_sql text;
BEGIN
  IF v_viewer IS NULL OR p_club_id IS NULL THEN RETURN; END IF;
  IF v_kind NOT IN ('all', 'cashout', 'transfer', 'game') THEN
    RAISE EXCEPTION 'transaction_history_kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'transaction_history_range_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'transaction_history_cursor_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT b.book, b.people, b.subject INTO v_book, v_people, v_subject
    FROM public.fn_cashier_history_book(p_club_id, v_viewer, p_scope, p_person) b;
  IF v_book IS NULL THEN RETURN; END IF;

  v_filter := CASE v_kind
         WHEN 'cashout' THEN ' AND ct.transaction_type = ANY (' || c_cashout || ')'
         WHEN 'transfer' THEN ' AND ct.transaction_type = ANY (' || c_transfer || ')'
         WHEN 'game' THEN ' AND false'
         ELSE ' AND (ct.transaction_type = ANY (' || c_cashout || ') OR ct.transaction_type = ANY (' || c_transfer || '))' END
    || CASE WHEN p_from IS NOT NULL THEN ' AND ct.created_at >= $4' ELSE '' END
    || CASE WHEN p_to IS NOT NULL THEN ' AND ct.created_at < $5' ELSE '' END
    || CASE WHEN p_before_at IS NOT NULL THEN ' AND (ct.created_at, ct.id) < ($6, $7)' ELSE '' END;
  v_rest := CASE WHEN p_from IS NOT NULL THEN ' AND ct.created_at >= $4' ELSE '' END
    || CASE WHEN p_to IS NOT NULL THEN ' AND ct.created_at < $5' ELSE '' END
    || CASE WHEN p_before_at IS NOT NULL THEN ' AND (ct.created_at, ct.id) < ($6, $7)' ELSE '' END;

  IF v_search IS NOT NULL THEN
    IF length(v_search) < 2 THEN RETURN; END IF;
    IF v_search ~* '^CA-[0-9]{4}-[0-9]+$' THEN
      -- An invoice number names the ledger legs it documents, in this club.
      SELECT array_agg(e.source_transaction_id) INTO v_ids
        FROM public.settlement_invoices i
        JOIN public.accounting_cashier_events e ON e.invoice_id = i.id
       WHERE i.invoice_number = upper(v_search) AND i.club_id = p_club_id
         AND e.source_transaction_id IS NOT NULL;
      IF v_ids IS NULL THEN RETURN; END IF;
      v_filter := v_filter || ' AND ct.id = ANY ($9)';
      v_rest := v_rest || ' AND ct.id = ANY ($9)';
    ELSE
      -- Part of an arena name: the members of this club it matches.
      SELECT array_agg(m.user_id) INTO v_match
        FROM (
          SELECT DISTINCT cm.user_id
            FROM public.club_members cm
            JOIN public.profiles pr ON pr.id = cm.user_id
           WHERE cm.club_id = p_club_id
             AND public.fn_arena_name(pr.alias, pr.username, pr.display_name, pr.first_name, pr.last_name, pr.full_name)
                 ILIKE '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           LIMIT 200
        ) m;
      IF v_match IS NULL THEN RETURN; END IF;
      IF v_book = 'club' THEN
        -- The club book reads each matched member's rows directly.
        v_people := v_match;
        v_book := 'people';
      ELSE
        v_filter := v_filter || ' AND (ct.from_user_id = ANY ($10) OR ct.to_user_id = ANY ($10))';
      END IF;
    END IF;
  END IF;

  IF v_book = 'club' THEN
    -- The club book is mostly game rows (1,073,286 club rows, 16,307 of them
    -- cashier types, 2026-11-14), so one filter over the (club_id, created_at)
    -- index walked the whole club and timed out on All Time. Each type group
    -- reads its own index instead: transfers off the partial
    -- idx_chip_tx_club_transfer_created, cash-outs off the transaction_type
    -- index (a few dozen rows per club), then the two newest-first runs merge.
    -- v_filter without its type clause carries the range, cursor and search.
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
        || ') x ORDER BY x.created_at DESC, x.id DESC LIMIT $8' END;
  ELSE
    -- One person, a downline or the matched members: each person's newest
    -- rows come straight off the (club_id, from_user_id, created_at) and
    -- (club_id, to_user_id, created_at) indexes, then merge.
    v_pick := 'SELECT DISTINCT ON (x.created_at, x.id) x.id FROM unnest($3) AS p(uid) CROSS JOIN LATERAL ('
      || '(SELECT ct.id, ct.created_at FROM public.chip_transactions ct WHERE ct.club_id = $1 AND ct.from_user_id = p.uid' || v_filter
      || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8)'
      || ' UNION ALL '
      || '(SELECT ct.id, ct.created_at FROM public.chip_transactions ct WHERE ct.club_id = $1 AND ct.to_user_id = p.uid' || v_filter
      || ' ORDER BY ct.created_at DESC, ct.id DESC LIMIT $8)'
      || ') x ORDER BY x.created_at DESC, x.id DESC LIMIT $8';
  END IF;

  v_sql := 'WITH picked AS MATERIALIZED (' || v_pick || ')' || $q$
    SELECT ct.id, ct.created_at,
           CASE WHEN ct.transaction_type = 'horse_treasury_funding' THEN 'club_bank_send' ELSE ct.transaction_type END,
           ct.amount,
           CASE WHEN ct.transaction_type = 'horse_treasury_funding' OR (ct.transaction_type = 'club_bank_send' AND $2 IS DISTINCT FROM ct.from_user_id AND $2 IS DISTINCT FROM ct.to_user_id) THEN NULL ELSE ct.from_user_id END,
           ct.to_user_id,
           CASE WHEN ct.transaction_type = 'horse_treasury_funding' OR ct.notes ~* 'horse'
                  OR (ct.transaction_type = 'club_bank_send' AND ct.notes = 'Club Bank Send') THEN NULL
                ELSE ct.notes END,
           CASE WHEN ct.transaction_type IN ('club_bank_send', 'horse_treasury_funding')
                THEN jsonb_build_object('destination', coalesce(ct.metadata ->> 'destination', 'player_wallet'))
                ELSE ct.metadata END,
           CASE WHEN pf.id IS NOT NULL AND NOT (ct.transaction_type = 'horse_treasury_funding' OR (ct.transaction_type = 'club_bank_send' AND $2 IS DISTINCT FROM ct.from_user_id AND $2 IS DISTINCT FROM ct.to_user_id))
                THEN public.fn_arena_name(pf.alias, pf.username, pf.display_name, pf.first_name, pf.last_name, pf.full_name) END,
           CASE WHEN pt.id IS NOT NULL THEN public.fn_arena_name(pt.alias, pt.username, pt.display_name, pt.first_name, pt.last_name, pt.full_name) END,
           cr.status,
           cr.created_at,
           si.invoice_number
      FROM picked
      JOIN public.chip_transactions ct ON ct.id = picked.id
      LEFT JOIN public.profiles pf ON pf.id = ct.from_user_id
      LEFT JOIN public.profiles pt ON pt.id = ct.to_user_id
      LEFT JOIN public.cashout_requests cr
        ON cr.id = ct.related_cashout_id
       AND ct.transaction_type IN ('cashout_request_escrow', 'cashout_approved', 'cashout_denied', 'cashout_cancelled', 'cashout_expired_refund')
      LEFT JOIN public.accounting_cashier_events ae ON ae.source_transaction_id = ct.id
      LEFT JOIN public.settlement_invoices si ON si.id = ae.invoice_id
     ORDER BY ct.created_at DESC, ct.id DESC$q$;

  RETURN QUERY EXECUTE v_sql
    USING p_club_id, v_viewer, v_people, p_from, p_to, p_before_at, p_before_id, v_limit, v_ids, v_match;
END
$function$

;
COMMIT;
