-- ROOT CAUSE of the 2026-11-09 union round-3 refusal loop (40+ identical
-- attempts since 10:54Z, every one rolled back whole): two correct rules
-- compose into a deadlock. The rakeback stage pays every earning player
-- (horses identically to humans, CLAUDE.md 10.5), and the Horse Club Split
-- trigger zzzz_horse_split_late_credit_returns_to_bank (Dan, 2026-11-03:
-- "a late prize on a split-departed horse record returns to the club bank")
-- immediately and with its own ledger row returns each such credit to the
-- club bank, inside the same statement. 333 split-departed horse payees
-- across 2 clubs (17,865.99 this week) therefore end the batch at their
-- opening balance, and the stage's final player-wallet conservation check,
-- which expects opening + delta, refuses the whole batch - holding every
-- other payee's rakeback with it. The money flow is already correct and
-- fully receipted (pay -> receipted return -> club bank); only the check's
-- model is incomplete. This migration teaches the player final-balance
-- check to expect opening + delta - (this transaction's receipted split
-- late returns for that wallet, from ca_horse_club_split_late_returns,
-- returned_at >= transaction_timestamp(); those wallets are locked FOR NO
-- KEY UPDATE by this stage, so no other transaction can add returns for
-- them concurrently). The refusal and its named-wallet DETAIL stay; the
-- agent-wallet check is untouched (the split trigger targets club_members
-- only). A regression pinning this composition follows in its own PR.
-- @live-proof: position('ca_horse_club_split_late_returns' in pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 src text;
 old_player text := $o$ IF EXISTS(SELECT 1 FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id
   WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta)
 THEN RAISE EXCEPTION 'routed_rakeback_final_balance_incorrect' USING ERRCODE='23514',
   DETAIL=left('final_balance_disagreements: '||COALESCE((SELECT jsonb_agg(jsonb_build_object('club',w.club_id,'user',w.user_id,'opening',w.opening,'delta',w.delta,'actual',cm.chip_balance,'off_by',round(cm.chip_balance-(w.opening+w.delta),2)) ORDER BY abs(cm.chip_balance-(w.opening+w.delta)) DESC) FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta)::text,'none'),3200); END IF;$o$;
 new_player text := $n$ CREATE TEMP TABLE IF NOT EXISTS _routed_split_returns(club_id uuid,user_id uuid,returned numeric,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._routed_split_returns;
 INSERT INTO pg_temp._routed_split_returns(club_id,user_id,returned)
 SELECT lr.club_id,lr.horse_id,sum(lr.amount) FROM public.ca_horse_club_split_late_returns lr
  JOIN pg_temp._routed_player_wallets pw ON pw.club_id=lr.club_id AND pw.user_id=lr.horse_id
  WHERE lr.returned_at >= transaction_timestamp() GROUP BY lr.club_id,lr.horse_id;
 IF EXISTS(SELECT 1 FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id
   LEFT JOIN pg_temp._routed_split_returns sr ON sr.club_id=w.club_id AND sr.user_id=w.user_id
   WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta-COALESCE(sr.returned,0))
 THEN RAISE EXCEPTION 'routed_rakeback_final_balance_incorrect' USING ERRCODE='23514',
   DETAIL=left('final_balance_disagreements: '||COALESCE((SELECT jsonb_agg(jsonb_build_object('club',w.club_id,'user',w.user_id,'opening',w.opening,'delta',w.delta,'split_returned',COALESCE(sr.returned,0),'actual',cm.chip_balance,'off_by',round(cm.chip_balance-(w.opening+w.delta-COALESCE(sr.returned,0)),2)) ORDER BY abs(cm.chip_balance-(w.opening+w.delta-COALESCE(sr.returned,0))) DESC) FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id LEFT JOIN pg_temp._routed_split_returns sr ON sr.club_id=w.club_id AND sr.user_id=w.user_id WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta-COALESCE(sr.returned,0))::text,'none'),3200); END IF;$n$;
BEGIN
 src := pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
 IF md5(src) IS DISTINCT FROM '9383d25b5115fcadc59d875b1e203808' THEN
  RAISE EXCEPTION 'rakeback_stage_preimage_changed md5=%', md5(src);
 END IF;
 IF (length(src)-length(replace(src,old_player,'')))/length(old_player) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one player final-balance refusal';
 END IF;
 src := replace(src, old_player, new_player);
 EXECUTE src;
 src := pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
 IF position('ca_horse_club_split_late_returns' in src) = 0
    OR position('routed_rakeback_final_balance_incorrect' in src) = 0 THEN
  RAISE EXCEPTION 'postimage missing split-return model';
 END IF;
END $patch$;
COMMIT;
