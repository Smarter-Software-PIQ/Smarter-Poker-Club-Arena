-- Split-return accounting starts with the actual locked wallet opening,
-- never with the outer transaction clock. No payments or receipts are replayed.
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))='21409a0d24523597e10b5da44c252840'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $patch$
DECLARE src text:=pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '23dae39efbca9d472bc519161c10196f' THEN RAISE EXCEPTION 'split_wallet_opening_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$old0$ deleted_deferral:=current_setting('app.deleted_wallet_routing_stage',true);$old0$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'split_wallet_opening_anchor_changed';END IF;
 src:=replace(src,$old0$ deleted_deferral:=current_setting('app.deleted_wallet_routing_stage',true);$old0$,$new0$ -- Wallets above are locked: their opening already includes every prior return.
 -- Capture the same boundary for the receipt sum, including earlier calls in
 -- this transaction. Only this stage's subsequent return delta is subtracted.
 CREATE TEMP TABLE IF NOT EXISTS _routed_split_return_openings(club_id uuid,user_id uuid,returned numeric,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._routed_split_return_openings;
 INSERT INTO pg_temp._routed_split_return_openings(club_id,user_id,returned)
 SELECT w.club_id,w.user_id,COALESCE(sum(lr.amount),0)
 FROM pg_temp._routed_player_wallets w LEFT JOIN public.ca_horse_club_split_late_returns lr
  ON lr.club_id=w.club_id AND lr.horse_id=w.user_id GROUP BY w.club_id,w.user_id;
 deleted_deferral:=current_setting('app.deleted_wallet_routing_stage',true);$new0$);
 IF cardinality(string_to_array(src,$old1$SELECT lr.club_id,lr.horse_id,sum(lr.amount) FROM public.ca_horse_club_split_late_returns lr$old1$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'split_wallet_opening_anchor_changed';END IF;
 src:=replace(src,$old1$SELECT lr.club_id,lr.horse_id,sum(lr.amount) FROM public.ca_horse_club_split_late_returns lr$old1$,$new1$SELECT lr.club_id,lr.horse_id,sum(lr.amount)-b.returned FROM public.ca_horse_club_split_late_returns lr$new1$);
 IF cardinality(string_to_array(src,$old2$  WHERE lr.returned_at >= transaction_timestamp() GROUP BY lr.club_id,lr.horse_id;$old2$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'split_wallet_opening_anchor_changed';END IF;
 src:=replace(src,$old2$  WHERE lr.returned_at >= transaction_timestamp() GROUP BY lr.club_id,lr.horse_id;$old2$,$new2$  JOIN pg_temp._routed_split_return_openings b ON b.club_id=lr.club_id AND b.user_id=lr.horse_id
  GROUP BY lr.club_id,lr.horse_id,b.returned;$new2$);
 EXECUTE src;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '21409a0d24523597e10b5da44c252840' THEN RAISE EXCEPTION 'split_wallet_opening_postimage_changed';END IF;
END $patch$;
COMMIT;
