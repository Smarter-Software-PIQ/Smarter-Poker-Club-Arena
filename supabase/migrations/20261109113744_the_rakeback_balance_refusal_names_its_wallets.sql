-- The union week of 2026-11-02 -> 2026-11-09 is refusing round 3 on every
-- attempt (22 identical failures by 11:30Z) with
-- routed_rakeback_final_balance_incorrect, and the raise names no wallet, so
-- the rolled-back attempt leaves no evidence of WHICH locked wallet disagreed
-- or by how much (the aborted writes are unobservable from outside). A signal
-- that answers without saying what it saw cannot be acted on (CLAUDE.md
-- 10.86). This migration makes both final-balance refusals carry the
-- disagreeing rows (club, user, opening, modeled delta, actual balance) in the
-- error DETAIL, largest disagreement first. The stage still refuses and rolls
-- back exactly as before; only the error's evidence changes. The root fix
-- follows once the wallets are named by the next automatic retry.
-- @live-proof: position('routed_rakeback_final_balance_incorrect' in pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) > 0 AND position('final_balance_disagreements' in pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 src text;
 old_player text := $o$ IF EXISTS(SELECT 1 FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id
   WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta)
 THEN RAISE EXCEPTION 'routed_rakeback_final_balance_incorrect' USING ERRCODE='23514'; END IF;$o$;
 new_player text := $n$ IF EXISTS(SELECT 1 FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id
   WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta)
 THEN RAISE EXCEPTION 'routed_rakeback_final_balance_incorrect' USING ERRCODE='23514',
   DETAIL=left('final_balance_disagreements: '||COALESCE((SELECT jsonb_agg(jsonb_build_object('club',w.club_id,'user',w.user_id,'opening',w.opening,'delta',w.delta,'actual',cm.chip_balance,'off_by',round(cm.chip_balance-(w.opening+w.delta),2)) ORDER BY abs(cm.chip_balance-(w.opening+w.delta)) DESC) FROM pg_temp._routed_player_wallets w JOIN public.club_members cm ON cm.club_id=w.club_id AND cm.user_id=w.user_id WHERE cm.chip_balance IS DISTINCT FROM w.opening+w.delta)::text,'none'),3200); END IF;$n$;
 old_agent text := $o$ IF EXISTS(SELECT 1 FROM pg_temp._routed_agent_wallets w LEFT JOIN public.agents a ON a.club_id=w.club_id AND a.user_id=w.user_id
   WHERE a.agent_wallet_balance IS DISTINCT FROM w.opening+w.delta)
 THEN RAISE EXCEPTION 'routed_rakeback_final_agent_wallet_incorrect' USING ERRCODE='23514'; END IF;$o$;
 new_agent text := $n$ IF EXISTS(SELECT 1 FROM pg_temp._routed_agent_wallets w LEFT JOIN public.agents a ON a.club_id=w.club_id AND a.user_id=w.user_id
   WHERE a.agent_wallet_balance IS DISTINCT FROM w.opening+w.delta)
 THEN RAISE EXCEPTION 'routed_rakeback_final_agent_wallet_incorrect' USING ERRCODE='23514',
   DETAIL=left('final_balance_disagreements: '||COALESCE((SELECT jsonb_agg(jsonb_build_object('club',w.club_id,'user',w.user_id,'opening',w.opening,'delta',w.delta,'actual',a.agent_wallet_balance,'off_by',round(COALESCE(a.agent_wallet_balance,0)-(w.opening+w.delta),2)) ORDER BY abs(COALESCE(a.agent_wallet_balance,0)-(w.opening+w.delta)) DESC) FROM pg_temp._routed_agent_wallets w LEFT JOIN public.agents a ON a.club_id=w.club_id AND a.user_id=w.user_id WHERE a.agent_wallet_balance IS DISTINCT FROM w.opening+w.delta)::text,'none'),3200); END IF;$n$;
BEGIN
 src := pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
 IF md5(src) IS DISTINCT FROM '3e86c68bae02fb88d651ba5498620db8' THEN
  RAISE EXCEPTION 'rakeback_stage_preimage_changed md5=%', md5(src);
 END IF;
 IF (length(src)-length(replace(src,old_player,'')))/length(old_player) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one player final-balance refusal';
 END IF;
 IF (length(src)-length(replace(src,old_agent,'')))/length(old_agent) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one agent final-balance refusal';
 END IF;
 src := replace(replace(src, old_player, new_player), old_agent, new_agent);
 EXECUTE src;
 src := pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
 IF position('final_balance_disagreements' in src) = 0
    OR position('routed_rakeback_final_balance_incorrect' in src) = 0
    OR position('routed_rakeback_final_agent_wallet_incorrect' in src) = 0 THEN
  RAISE EXCEPTION 'postimage missing expected refusal evidence';
 END IF;
END $patch$;
COMMIT;
