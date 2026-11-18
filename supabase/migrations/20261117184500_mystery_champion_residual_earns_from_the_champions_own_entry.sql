-- A Mystery Bounty champion's residual earns from the champion's own entry.
--
-- fn_mystery_bounty_settle pays the chests nobody won to the champion as one
-- more amount on the champion's 'mystery_bounty' obligation. It calls
-- fn_settle_tournament_obligation without app.bounty_obligation_id, because no
-- knockout and no hand earned it: the champion earned it by winning. Since
-- Promo Play Through enforcement (2026-11-17 14:28Z) the obligation trigger
-- fn_ca_promo_profit_capture_obligation_earning requires a knockout context for
-- every 'bounty' and 'mystery_bounty' amount and raises
-- original_bounty_earning_hand_missing without one. The whole terminal
-- settlement then rolls back: a Mystery Bounty event that ends with unclaimed
-- chests cannot complete and its winner is unpaid. Production paid this
-- residual 66 times in the last 120 days (last on 2026-10-05); no Mystery
-- Bounty event has finished since enforcement, so it has not fired yet.
--
-- The trigger now routes exactly that case through its existing place-prize
-- branch (the champion's own current entry generation, earned now):
--   kind 'mystery_bounty', no place, no knockout context, and the recipient is
--   the tournament's single recorded winner (status 'winner', position 1),
--   which fn_mystery_bounty_settle itself requires before paying.
-- Every knockout payment still requires its knockout hand, and any other
-- 'bounty' or 'mystery_bounty' amount without context still refuses.
-- No money, ledger, obligation or settlement row is touched.
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure AND position($a$NOT (NEW.kind='mystery_bounty' AND NEW.place IS NULL AND NULLIF(current_setting('app.bounty_obligation_id',true),'') IS NULL$a$ IN pg_get_functiondef(p.oid))>0 AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres}')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
DO $champion$
DECLARE d text; before_anchor text; after_anchor text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure);
 before_anchor:=$a$ IF NEW.kind IN('bounty','mystery_bounty') THEN
  bounty:=$a$;
 after_anchor:=$a$ IF NEW.kind IN('bounty','mystery_bounty') AND NOT (NEW.kind='mystery_bounty' AND NEW.place IS NULL AND NULLIF(current_setting('app.bounty_obligation_id',true),'') IS NULL
   AND EXISTS(SELECT 1 FROM public.tournament_players w WHERE w.tournament_id=NEW.tournament_id AND w.user_id=NEW.user_id AND w.status='winner' AND w.position=1)
   AND (SELECT count(*) FROM public.tournament_players w WHERE w.tournament_id=NEW.tournament_id AND w.status='winner' AND w.position=1)=1) THEN
  bounty:=$a$;
 IF (length(d)-length(replace(d,after_anchor,'')))/length(after_anchor)=1
    AND position(before_anchor IN d)=0 THEN
  RETURN; -- already installed: idempotent
 END IF;
 IF (length(d)-length(replace(d,before_anchor,'')))/length(before_anchor)<>1 THEN
  RAISE EXCEPTION 'MYSTERY_CHAMPION_RESIDUAL_ANCHOR_NOT_EXACTLY_ONCE';
 END IF;
 EXECUTE replace(d,before_anchor,after_anchor);
 d:=pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure);
 IF position(after_anchor IN d)=0 OR position(before_anchor IN d)>0 THEN
  RAISE EXCEPTION 'MYSTERY_CHAMPION_RESIDUAL_NOT_INSTALLED';
 END IF;
END $champion$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_obligation_earning() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
