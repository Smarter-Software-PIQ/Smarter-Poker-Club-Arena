-- A tournament hand that straddles an add-on or rebuy commits under Promo
-- Play Through. Since enforcement at 14:28Z on 2026-11-17 the capture guard in
-- fn_ca_promo_profit_capture_tournament_hand compared the commit's written
-- stack with the engine's ending stack. In delta mode the original commit
-- (fn_ca_settle_hand_stacks_absolute) writes round(db_before + engine_after -
-- engine_before, 2) and records the difference db_before - engine_before as
-- stack_result.rebased[user]. A between-hand add-on therefore makes written
-- exactly engine stack + rebased, the guard raised
-- original_tournament_earning_hand_players_mismatch, the whole hand rolled
-- back on every identical replay, and Morning Free Buy f6990f30 tables
-- 196db7be (hand #59866957) and d6a9e2ff (hand #59866958) stopped dealing at
-- 15:32Z after the 3,000-chip add-on.
--
-- This changes one comparison to the commit's own equation: written must equal
-- engine stack + COALESCE(rebased[user], 0). Any other difference still
-- refuses. No money, ledger, seat, hand or settlement row is touched; the
-- stranded hands commit on the engine's own next identical replay.
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure AND position($a$IS DISTINCT FROM (v->>'stack')::numeric+COALESCE((h.stack_result->'rebased'->>(v->>'user_id'))::numeric,0)$a$ IN pg_get_functiondef(p.oid))>0 AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres}')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
DO $rebased$
DECLARE d text; before_anchor text; after_anchor text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure);
 before_anchor:=$a$(h.stack_result->'written'->>(v->>'user_id'))::numeric IS DISTINCT FROM (v->>'stack')::numeric) THEN RAISE EXCEPTION 'original_tournament_earning_hand_players_mismatch'$a$;
 after_anchor:=$a$(h.stack_result->'written'->>(v->>'user_id'))::numeric IS DISTINCT FROM (v->>'stack')::numeric+COALESCE((h.stack_result->'rebased'->>(v->>'user_id'))::numeric,0)) THEN RAISE EXCEPTION 'original_tournament_earning_hand_players_mismatch'$a$;
 IF (length(d)-length(replace(d,after_anchor,'')))/length(after_anchor)=1
    AND position(before_anchor IN d)=0 THEN
  RETURN; -- already installed: idempotent
 END IF;
 IF (length(d)-length(replace(d,before_anchor,'')))/length(before_anchor)<>1 THEN
  RAISE EXCEPTION 'PROMO_TOURNAMENT_HAND_REBASE_ANCHOR_NOT_EXACTLY_ONCE';
 END IF;
 EXECUTE replace(d,before_anchor,after_anchor);
 d:=pg_get_functiondef('public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure);
 IF position(after_anchor IN d)=0 OR position(before_anchor IN d)>0 THEN
  RAISE EXCEPTION 'PROMO_TOURNAMENT_HAND_REBASE_NOT_INSTALLED';
 END IF;
END $rebased$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
