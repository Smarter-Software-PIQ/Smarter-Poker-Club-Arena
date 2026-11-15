-- Apply the funding-wallet predicate to both indexed club type groups and
-- to the existing name-search book, before any per-group or page limit.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure) LIKE '%funded_union_promo_wallet%')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $migration$
DECLARE
  body text := pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure);
  kinds constant text := $src$'member_union_promo_wallet')$src$;
  filters constant text := $src$  IF left(v_kind, 7) = 'member_' THEN$src$;
BEGIN
  IF md5(body) <> '6c73793fccbdd5f4c2790f1ea0376e0c'
      OR strpos(body,kinds) = 0 OR strpos(body,filters) = 0 THEN
    RAISE EXCEPTION 'Cashier history source changed before club wallet filter installation';
  END IF;
  body := replace(body,kinds,$src$'member_union_promo_wallet',
      'funded_player_wallet', 'funded_agent_wallet', 'funded_promo_wallet',
      'funded_club_bank', 'funded_club_promo_wallet', 'funded_union_promo_wallet',
      'funded_held_cashout')$src$);
  EXECUTE replace(body,filters,$src$  IF left(v_kind, 7) = 'funded_' THEN
    IF v_book <> 'club' THEN RETURN; END IF;
    v_rest := v_rest || ' AND public.fn_cashier_history_funding_wallet(ct.transaction_type, ct.metadata) = $13';
    v_filter := v_filter || ' AND public.fn_cashier_history_funding_wallet(ct.transaction_type, ct.metadata) = $13';
  END IF;
$src$ || filters);
END
$migration$;
COMMIT;
