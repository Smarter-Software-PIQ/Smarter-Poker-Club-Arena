-- Extend the metadata of the existing authorized, cursor-paged member feed.
-- Only the displayed agent promo rows need a historical recipient total.
-- No writes to wallets, journals or transaction history.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure) LIKE '%promo_used_after_send%')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure);
  old_metadata constant text := 'ELSE ct.metadata END,';
  new_metadata constant text := $sql$
                WHEN $11 IS NOT NULL AND ct.transaction_type = 'promo_wallet_send'
                     AND ct.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
                THEN ct.metadata || jsonb_build_object('promo_used_after_send', (
                  SELECT sum(receipt.amount)::text
                    FROM public.chip_transactions receipt
                   WHERE receipt.club_id = ct.club_id AND receipt.to_user_id = ct.to_user_id
                     AND receipt.transaction_type = 'promo_wallet_send'
                     AND receipt.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
                     AND receipt.created_at > ct.created_at - interval '168 hours'
                     AND (receipt.created_at, receipt.id) <= (ct.created_at, ct.id)
                ))
                ELSE ct.metadata END,$sql$;
  old_args constant text := 'v_limit, v_ids, v_match;';
BEGIN
  IF md5(definition) <> 'a26c9b5097203fdc0b3109bd649ddec1' THEN
    RAISE EXCEPTION 'Cashier history feed changed before member allowance installation';
  END IF;
  IF strpos(definition, old_metadata) = 0 OR strpos(definition, old_args) = 0 THEN
    RAISE EXCEPTION 'Member history projection anchors missing';
  END IF;
  EXECUTE replace(replace(definition, old_metadata, new_metadata), old_args, 'v_limit, v_ids, v_match, p_person;');
END
$migration$;
COMMIT;
