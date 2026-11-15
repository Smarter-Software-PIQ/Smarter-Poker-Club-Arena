-- Classify funding from the recorded writer contract without changing any receipt.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure) LIKE '%member_union_promo_wallet%' AND pg_get_functiondef('public.fn_cashier_history_funding_wallet(text,jsonb)'::regprocedure) LIKE '%issuer_balance_after%')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $migration$
DECLARE
  wallet_def text := pg_get_functiondef('public.fn_cashier_history_funding_wallet(text,jsonb)'::regprocedure);
  feed_def text := pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure);
  wallet_anchor constant text := $sql$    WHEN p_type = 'promo_wallet_send' THEN 'promo_wallet'$sql$;
  feed_anchor constant text := $sql$'member_club_promo_wallet', 'member_held_cashout')$sql$;
BEGIN
  IF md5(wallet_def) <> '186df32d0f743907f0edcf886b0efc8c' OR strpos(wallet_def,wallet_anchor) = 0
     OR md5(feed_def) <> '553be2e8b21cd6404a32add126a8b7d0' OR strpos(feed_def,feed_anchor) = 0 THEN
    RAISE EXCEPTION 'Member history wallet source or feed changed before ticket and union funding installation';
  END IF;
  -- The cashier stores the issuer and numeric balance after its debit.
  -- A tournament payout also issues a ticket, without drawing on that wallet.
  EXECUTE replace(wallet_def,wallet_anchor,$sql$    WHEN p_type = 'tournament_ticket_issue'
         AND jsonb_typeof(p_metadata->'issuer_id') = 'string'
         AND p_metadata->>'issuer_id' ~ '[^[:space:]]'
         AND jsonb_typeof(p_metadata->'issuer_balance_after') = 'number'
         AND p_metadata->>'source_satellite_id' IS NULL AND p_metadata->>'payout_id' IS NULL THEN 'player_wallet'
    WHEN p_type IN ('union_promo_send','union_promo_to_club')
         OR (p_type = 'promo_disbursement' AND p_metadata->>'source_kind' = 'union') THEN 'union_promo_wallet'
$sql$ || wallet_anchor);
  EXECUTE replace(feed_def,feed_anchor,$sql$'member_club_promo_wallet', 'member_held_cashout', 'member_union_promo_wallet')$sql$);
END
$migration$;
COMMIT;
